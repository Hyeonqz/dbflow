import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChangeRequestStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChangeRequestService } from './change-request.service';
import { Decision } from './dto/decision.dto';

const S = ChangeRequestStatus;

/** Minimal actor snapshot for audit — tests only care about userId/role unless noted. */
const actor = (userId: string, role: Role = Role.DEVELOPER): any => ({
  userId,
  role,
  name: 'N',
  department: 'D',
});

/** Multi-approver policy always requires 1 approver (single-approver reproduction). */
const policyMock: any = { getRequired: () => Promise.resolve(1) };

/** Default delegation stub — no active delegations. Override per-test as needed. */
const delegationMock: any = {
  activeDelegatorIds: async () => [],
  isActiveDelegateFor: async () => false,
};

type StoredCr = {
  id: string;
  status: ChangeRequestStatus;
  authorId: string;
  reviewerId?: string | null;
  targetEnv?: string;
};

/**
 * Builds a ChangeRequestService backed by a hand-rolled Prisma mock.
 * `update` / `statusHistory.create` are captured so transition effects can be
 * asserted; `$transaction` runs either an ops array (applyTransition) or an
 * interactive callback (setAssignees) against the same mock.
 */
function makeService(stored?: StoredCr, delegation: any = delegationMock) {
  const updateMock = jest.fn().mockResolvedValue({});
  const historyMock = jest.fn().mockResolvedValue({});
  const findManyMock = jest.fn().mockResolvedValue([]);
  const findFirstMock = jest.fn().mockResolvedValue(null);
  const createManyMock = jest.fn().mockResolvedValue({ count: 0 });
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    changeRequest: {
      create: jest.fn().mockResolvedValue({
        id: 'cr-new',
        author: { name: '개발자' },
        files: [],
        statusHistory: [],
        approvers: [],
      }),
      findMany: findManyMock,
      findFirst: findFirstMock,
      findUnique: jest.fn().mockResolvedValue(stored ?? null),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          author: { name: '개발자' },
          files: [],
          statusHistory: [],
          approvers: [],
        }),
      ),
      update: updateMock,
    },
    changeRequestApprover: {
      count: jest.fn().mockResolvedValue(1),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: createManyMock,
    },
    statusHistory: { create: historyMock },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  };
  const service = new ChangeRequestService(prisma, new AuditService(prisma), policyMock, delegation);
  return { service, prisma, updateMock, historyMock, findManyMock, findFirstMock, createManyMock };
}

const lastHistory = (historyMock: jest.Mock) => historyMock.mock.calls.at(-1)?.[0].data;

describe('ChangeRequestService', () => {
  describe('submit (DRAFT -> SUBMITTED, author only)', () => {
    it('transitions and records history when author submits a DRAFT', async () => {
      const { service, updateMock, historyMock } = makeService({
        id: 'cr1',
        status: S.DRAFT,
        authorId: 'u1',
        reviewerId: 'dba',
        targetEnv: 'DEV',
      });

      await service.submit(actor('u1'), 'cr1');

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 'cr1' },
        data: { status: S.SUBMITTED },
      });
      expect(lastHistory(historyMock)).toEqual({
        changeRequestId: 'cr1',
        fromStatus: S.DRAFT,
        toStatus: S.SUBMITTED,
        actorId: 'u1',
        comment: null,
      });
    });

    it('forbids a non-author from submitting and performs no transition', async () => {
      const { service, updateMock, historyMock } = makeService({
        id: 'cr1',
        status: S.DRAFT,
        authorId: 'u1',
      });

      await expect(service.submit(actor('intruder'), 'cr1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(updateMock).not.toHaveBeenCalled();
      expect(historyMock).not.toHaveBeenCalled();
    });

    it('rejects submit when not in DRAFT (409)', async () => {
      const { service } = makeService({
        id: 'cr1',
        status: S.SUBMITTED,
        authorId: 'u1',
        reviewerId: 'dba',
        targetEnv: 'DEV',
      });
      await expect(service.submit(actor('u1'), 'cr1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound when the change request does not exist', async () => {
      const { service } = makeService(undefined);
      await expect(service.submit(actor('u1'), 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('review (SUBMITTED -> REVIEW_APPROVED | REVIEW_REJECTED)', () => {
    it('APPROVE moves to REVIEW_APPROVED with comment', async () => {
      const { service, updateMock, historyMock, findFirstMock } = makeService({
        id: 'cr1',
        status: S.SUBMITTED,
        authorId: 'u1',
        reviewerId: 'dba',
      });
      findFirstMock.mockResolvedValueOnce({
        id: 'cr1',
        authorId: 'u1',
        author: { name: '개발자' },
        files: [],
        approvers: [],
        statusHistory: [],
      });

      await service.review(actor('dba', Role.REVIEWER), 'cr1', {
        decision: Decision.APPROVE,
        comment: '인덱스 적절',
      });

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 'cr1' },
        data: { status: S.REVIEW_APPROVED },
      });
      expect(lastHistory(historyMock)).toMatchObject({
        fromStatus: S.SUBMITTED,
        toStatus: S.REVIEW_APPROVED,
        actorId: 'dba',
        comment: '인덱스 적절',
      });
    });

    it('REJECT moves to REVIEW_REJECTED (terminal)', async () => {
      const { service, historyMock, findFirstMock } = makeService({
        id: 'cr1',
        status: S.SUBMITTED,
        authorId: 'u1',
        reviewerId: 'dba',
      });
      findFirstMock.mockResolvedValueOnce({
        id: 'cr1',
        authorId: 'u1',
        author: { name: '개발자' },
        files: [],
        approvers: [],
        statusHistory: [],
      });

      await service.review(actor('dba', Role.REVIEWER), 'cr1', { decision: Decision.REJECT });

      expect(lastHistory(historyMock)).toMatchObject({
        toStatus: S.REVIEW_REJECTED,
        comment: null,
      });
    });

    it('rejects review when not in SUBMITTED (409)', async () => {
      const { service } = makeService({
        id: 'cr1',
        status: S.DRAFT,
        authorId: 'u1',
        reviewerId: 'dba',
      });
      await expect(
        service.review(actor('dba', Role.REVIEWER), 'cr1', { decision: Decision.APPROVE }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('role-based visibility filter (list)', () => {
    it('DEVELOPER sees only own change requests', async () => {
      const { service, findManyMock } = makeService();
      await service.list({ userId: 'u1', role: Role.DEVELOPER });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { authorId: 'u1' } }),
      );
    });

    it('REVIEWER sees only assigned change requests, excluding DRAFT', async () => {
      const { service, findManyMock } = makeService();
      await service.list({ userId: 'dba', role: Role.REVIEWER });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ reviewerId: 'dba' }, { reviewerId: { in: [] } }],
            status: { not: S.DRAFT },
          },
        }),
      );
    });

    it('APPROVER sees only assigned change requests, excluding DRAFT', async () => {
      const { service, findManyMock } = makeService();
      await service.list({ userId: 'boss', role: Role.APPROVER });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { approvers: { some: { userId: 'boss' } } },
              { approvers: { some: { userId: { in: [] } } } },
            ],
            status: { not: S.DRAFT },
          },
        }),
      );
    });

    it('ADMIN and unknown roles see nothing via list', async () => {
      const { service, findManyMock } = makeService();
      await service.list({ userId: 'root', role: Role.ADMIN });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { equals: '' } } }),
      );
    });
  });

  describe('findOne visibility', () => {
    it('throws NotFound when the request is not visible to the user', async () => {
      const { service } = makeService();
      await expect(
        service.findOne({ userId: 'u1', role: Role.DEVELOPER }, 'cr-hidden'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('denormalized display names', () => {
    it('flattens authorName and per-history actorName for the detail view', async () => {
      const { service, findFirstMock } = makeService();
      findFirstMock.mockResolvedValueOnce({
        id: 'cr1',
        authorId: 'u1',
        author: { name: '개발자' },
        files: [],
        approvers: [],
        statusHistory: [
          {
            id: 'h1',
            fromStatus: S.DRAFT,
            toStatus: S.SUBMITTED,
            actorId: 'u1',
            comment: null,
            actor: { name: '개발자' },
          },
          {
            id: 'h2',
            fromStatus: S.SUBMITTED,
            toStatus: S.REVIEW_APPROVED,
            actorId: 'dba',
            comment: 'ok',
            actor: { name: '검토자' },
          },
        ],
      });

      const detail: any = await service.findOne({ userId: 'u1', role: Role.DEVELOPER }, 'cr1');

      expect(detail.authorName).toBe('개발자');
      expect(detail).not.toHaveProperty('author');
      expect(detail.statusHistory).toEqual([
        expect.objectContaining({ id: 'h1', actorId: 'u1', actorName: '개발자' }),
        expect.objectContaining({ id: 'h2', actorId: 'dba', actorName: '검토자' }),
      ]);
      expect(detail.statusHistory[0]).not.toHaveProperty('actor');
    });

    it('falls back to null name when the join is missing', async () => {
      const { service, findManyMock } = makeService();
      findManyMock.mockResolvedValueOnce([{ id: 'cr1', authorId: 'u1', author: null, approvers: [] }]);

      const [row]: any = await service.list({ userId: 'u1', role: Role.DEVELOPER });

      expect(row.authorName).toBeNull();
      expect(row).not.toHaveProperty('author');
    });
  });

  describe('delegatedFrom — 위임으로 넘어온 항목만 표시', () => {
    it('개발자 자신의 목록에서는 항상 null이다', async () => {
      // delegatorIds가 []이므로 구조적으로 null. 역할별 규칙으로 쓰면 여기서 오염된다.
      const { service, findManyMock } = makeService();
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.SUBMITTED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-dev', role: Role.DEVELOPER } as any);
      expect(rows[0].delegatedFrom).toBeNull();
    });

    it('SUBMITTED에서 검토자가 내 위임자면 그 이름을 준다', async () => {
      const delegation = { activeDelegatorIds: async () => ['u-rev'] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.SUBMITTED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-other', role: Role.REVIEWER } as any);
      expect(rows[0].delegatedFrom).toBe('검토자');
    });

    it('SUBMITTED에서 검토자가 나 자신이면 null이다', async () => {
      const delegation = { activeDelegatorIds: async () => [] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.SUBMITTED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-rev', role: Role.REVIEWER } as any);
      expect(rows[0].delegatedFrom).toBeNull();
    });

    it('SUBMITTED에서 나는 다른 사람의 위임자지만 이 건의 검토자는 그 사람이 아니면 null이다', async () => {
      // delegatorIds가 비어있지 않아 최상단 가드는 통과하지만, includes(reviewerId)는 거짓인 경우.
      const delegation = { activeDelegatorIds: async () => ['u-someone-else'] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.SUBMITTED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-other', role: Role.REVIEWER } as any);
      expect(rows[0].delegatedFrom).toBeNull();
    });

    it('REVIEW_APPROVED에서 내 미결정 슬롯이 있으면 null(자기 슬롯 우선)', async () => {
      const delegation = { activeDelegatorIds: async () => ['u-deleg'] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.REVIEW_APPROVED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
          approvers: [
            { userId: 'u-appr', decision: null, decidedById: null, user: { name: '나' } },
            { userId: 'u-deleg', decision: null, decidedById: null, user: { name: '위임자' } },
          ],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-appr', role: Role.APPROVER } as any);
      expect(rows[0].delegatedFrom).toBeNull();
    });

    it('REVIEW_APPROVED에서 내 슬롯이 없으면 위임자 슬롯(order 오름차순 첫) 이름', async () => {
      const delegation = { activeDelegatorIds: async () => ['u-d1', 'u-d2'] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.REVIEW_APPROVED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
          // SUMMARY_SELECT가 order asc로 정렬해 주므로 배열 순서가 곧 order다.
          approvers: [
            { userId: 'u-d1', decision: null, decidedById: null, user: { name: '위임자1' } },
            { userId: 'u-d2', decision: null, decidedById: null, user: { name: '위임자2' } },
          ],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-appr', role: Role.APPROVER } as any);
      expect(rows[0].delegatedFrom).toBe('위임자1');
    });

    it('그 외 상태에서는 null이다', async () => {
      const delegation = { activeDelegatorIds: async () => ['u-rev'] };
      const { service, findManyMock } = makeService(undefined, delegation);
      findManyMock.mockResolvedValue([
        {
          id: 'cr-1', status: S.APPLIED, authorId: 'u-dev',
          reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date(),
          author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
        },
      ]);
      const rows: any = await service.list({ userId: 'u-other', role: Role.REVIEWER } as any);
      expect(rows[0].delegatedFrom).toBeNull();
    });
  });
});

/** Prisma mock with only `findUnique` + submit/approve plumbing (policy, approver count). */
function svc(cr: any) {
  const prisma: any = {
    $queryRaw: () => Promise.resolve([]),
    changeRequest: { findUnique: () => Promise.resolve(cr) },
    changeRequestApprover: { count: () => Promise.resolve(cr?.approverId ? 1 : 0) },
  };
  prisma.$transaction = (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg);
  return new ChangeRequestService(prisma, new AuditService(prisma), policyMock, delegationMock);
}

describe('ChangeRequestService assignment gates', () => {
  it('rejects review by a non-assigned reviewer', async () => {
    const service = svc({ id: 'c1', status: 'SUBMITTED', authorId: 'a', reviewerId: 'r1' });
    await expect(
      service.review(actor('someone-else', Role.REVIEWER), 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects submit when reviewer/approver unassigned', async () => {
    const service = svc({ id: 'c1', status: 'DRAFT', authorId: 'a', reviewerId: null });
    await expect(service.submit(actor('a'), 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets author reassign only while DRAFT', async () => {
    const cr = { id: 'c1', status: 'SUBMITTED', authorId: 'a', reviewerId: 'r1' };
    const service = svc(cr);
    await expect(
      service.setAssignees(actor('a', Role.DEVELOPER), 'c1', { reviewerId: 'r2' }),
    ).rejects.toBeTruthy(); // 제출됨 + 작성자 → 불가(ADMIN만)
  });
});

describe('assertAssigneeRoles (spec §4.2 — role-match validation on assignment)', () => {
  it('rejects create when reviewerId points to a non-REVIEWER user', async () => {
    const { service, prisma } = makeService();
    prisma.user = {
      findUnique: jest.fn().mockResolvedValue({ role: Role.APPROVER }),
      findMany: jest.fn().mockResolvedValue([]),
    };

    await expect(
      service.create(actor('u1'), {
        title: 't',
        description: 'd',
        targetEnv: 'DEV',
        files: [{ filename: 'a.sql', sqlType: 'DDL', content: 'SELECT 1;' }],
        reviewerId: 'r1',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('succeeds when reviewer/approver roles match', async () => {
    const { service, prisma } = makeService();
    prisma.user = {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        if (where.id === 'r1') return Promise.resolve({ role: Role.REVIEWER });
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'p1', role: Role.APPROVER }]),
    };

    await expect(
      service.create(actor('u1'), {
        title: 't',
        description: 'd',
        targetEnv: 'DEV',
        files: [{ filename: 'a.sql', sqlType: 'DDL', content: 'SELECT 1;' }],
        reviewerId: 'r1',
        approverIds: ['p1'],
      } as any),
    ).resolves.toBeDefined();
  });
});

describe('setAssignees success paths', () => {
  it('lets ADMIN reassign reviewer/approvers on a non-DRAFT CR', async () => {
    const { service, prisma, updateMock, findFirstMock, createManyMock } = makeService({
      id: 'cr1',
      status: S.SUBMITTED,
      authorId: 'u1',
      reviewerId: 'r-old',
    });
    prisma.user = {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        if (where.id === 'r2') return Promise.resolve({ role: Role.REVIEWER });
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'p2', role: Role.APPROVER }]),
    };
    findFirstMock.mockResolvedValueOnce({
      id: 'cr1',
      authorId: 'u1',
      author: { name: '개발자' },
      files: [],
      approvers: [],
      statusHistory: [],
    });

    await service.setAssignees(actor('admin1', Role.ADMIN), 'cr1', {
      reviewerId: 'r2',
      approverIds: ['p2'],
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'cr1' },
      data: { reviewerId: 'r2' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [{ changeRequestId: 'cr1', userId: 'p2', order: 0 }],
    });
  });

  it('lets the DRAFT author reassign their own CR', async () => {
    const { service, prisma, updateMock, findFirstMock } = makeService({
      id: 'cr1',
      status: S.DRAFT,
      authorId: 'u1',
      reviewerId: null,
    });
    prisma.user = {
      findUnique: jest.fn().mockResolvedValue({ role: Role.REVIEWER }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    findFirstMock.mockResolvedValueOnce({
      id: 'cr1',
      authorId: 'u1',
      author: { name: '개발자' },
      files: [],
      approvers: [],
      statusHistory: [],
    });

    await service.setAssignees(actor('u1', Role.DEVELOPER), 'cr1', { reviewerId: 'r1' });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'cr1' },
      data: { reviewerId: 'r1' },
    });
  });
});

describe('setAssignees post-submit approver-count gate (policy invariant)', () => {
  const policyRequires2: any = { getRequired: () => Promise.resolve(2) };

  /** Same shape as makeService, but takes an explicit policy so required-count can differ. */
  function makeServiceWithPolicy(stored: StoredCr, policy: any) {
    const findFirstMock = jest.fn().mockResolvedValue(null);
    const createManyMock = jest.fn().mockResolvedValue({ count: 0 });
    const prisma: any = {
      changeRequest: {
        findUnique: jest.fn().mockResolvedValue(stored),
        update: jest.fn().mockResolvedValue({}),
        findFirst: findFirstMock,
      },
      changeRequestApprover: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: createManyMock,
      },
      user: {
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve((where.id.in as string[]).map((id) => ({ id, role: Role.APPROVER }))),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    const service = new ChangeRequestService(prisma, new AuditService(prisma), policy, delegationMock);
    return { service, findFirstMock, createManyMock };
  }

  it('rejects post-submit reassignment when approver count does not match policy', async () => {
    const { service } = makeServiceWithPolicy(
      { id: 'cr1', status: S.REVIEW_APPROVED, authorId: 'u1', reviewerId: 'r1', targetEnv: 'PROD' },
      policyRequires2,
    );

    await expect(
      service.setAssignees(actor('admin1', Role.ADMIN), 'cr1', { approverIds: ['p1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows post-submit reassignment when approver count matches policy', async () => {
    const { service, findFirstMock, createManyMock } = makeServiceWithPolicy(
      { id: 'cr1', status: S.REVIEW_APPROVED, authorId: 'u1', reviewerId: 'r1', targetEnv: 'PROD' },
      policyRequires2,
    );
    findFirstMock.mockResolvedValueOnce({
      id: 'cr1',
      authorId: 'u1',
      author: { name: '개발자' },
      files: [],
      approvers: [],
      statusHistory: [],
    });

    await service.setAssignees(actor('admin1', Role.ADMIN), 'cr1', { approverIds: ['p1', 'p2'] });

    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        { changeRequestId: 'cr1', userId: 'p1', order: 0 },
        { changeRequestId: 'cr1', userId: 'p2', order: 1 },
      ],
    });
  });

  it('still allows a DRAFT author to assign a mismatched approver count (pre-submit flexibility)', async () => {
    const { service, findFirstMock, createManyMock } = makeServiceWithPolicy(
      { id: 'cr1', status: S.DRAFT, authorId: 'u1', reviewerId: null, targetEnv: 'PROD' },
      policyRequires2,
    );
    findFirstMock.mockResolvedValueOnce({
      id: 'cr1',
      authorId: 'u1',
      author: { name: '개발자' },
      files: [],
      approvers: [],
      statusHistory: [],
    });

    await service.setAssignees(actor('u1', Role.DEVELOPER), 'cr1', { approverIds: ['p1'] });

    expect(createManyMock).toHaveBeenCalledWith({
      data: [{ changeRequestId: 'cr1', userId: 'p1', order: 0 }],
    });
  });
});

describe('applyTransition audit (audit write is inside the transition transaction)', () => {
  it('records the audit log inside the array-form transition transaction (submit path)', async () => {
    // review() moved to an interactive fn-form tx; submit() still uses applyTransition (array form).
    const calls: any = { tx: null };
    const prisma: any = {
      changeRequest: {
        findUnique: () =>
          Promise.resolve({
            id: 'c1',
            status: 'DRAFT',
            authorId: 'a',
            reviewerId: 'r1',
            targetEnv: 'DEV',
          }),
        update: () => ({}),
        findUniqueOrThrow: () =>
          Promise.resolve({
            id: 'c1',
            status: 'SUBMITTED',
            files: [],
            statusHistory: [],
            author: { name: 'A' },
            reviewer: null,
            approvers: [],
          }),
      },
      changeRequestApprover: { count: () => Promise.resolve(1) },
      statusHistory: { create: () => ({}) },
      auditLog: { create: (a: any) => a },
      $transaction: (arr: any[]) => {
        calls.tx = arr;
        return Promise.resolve([]);
      },
    };
    const audit = new AuditService(prisma);
    const svcInstance = new ChangeRequestService(prisma, audit, policyMock, delegationMock);
    await svcInstance.submit(actor('a'), 'c1');
    expect(calls.tx).toHaveLength(3); // update + statusHistory.create + auditLog.create
  });
});

/** Interactive `$transaction` mock for approve() collection logic. */
function txPrisma(state: any) {
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    changeRequest: {
      findUnique: () => Promise.resolve(state.cr),
      update: (a: any) => {
        state.cr.status = a.data.status;
        return Promise.resolve({});
      },
    },
    changeRequestApprover: {
      findUnique: ({ where }: any) =>
        Promise.resolve(
          state.approvers.find((x: any) => x.userId === where.changeRequestId_userId.userId) ?? null,
        ),
      update: ({ where, data }: any) => {
        const r = state.approvers.find((x: any) => x.id === where.id);
        Object.assign(r, data);
        return Promise.resolve({});
      },
      findFirst: ({ where }: any) => {
        if (where.OR) {
          // SoD 가드 조회: id != where.id.not && (본인 직접 결정 || 본인이 대리로 결정)
          return Promise.resolve(
            state.approvers.find(
              (x: any) =>
                x.id !== where.id?.not &&
                ((x.userId === where.OR[0].userId && x.decision != null) ||
                  x.decidedById === where.OR[1].decidedById),
            ) ?? null,
          );
        }
        return Promise.resolve( // 기존 위임 슬롯 조회
          state.approvers.find(
            (x: any) => where.userId.in.includes(x.userId) && x.decision === null,
          ) ?? null,
        );
      },
      findMany: () => Promise.resolve(state.approvers),
    },
    statusHistory: { create: () => Promise.resolve({}) },
    auditLog: { create: (a: any) => a },
  };
  return {
    $transaction: (fn: any) => fn(tx),
    changeRequest: {
      findFirst: () =>
        Promise.resolve({
          id: state.cr.id,
          files: [],
          statusHistory: [],
          author: { name: 'A' },
          reviewer: null,
          approvers: state.approvers,
        }),
    },
  };
}

describe('approve (multi-approver unanimous collection)', () => {
  it('transitions to FINAL_APPROVED only when all assigned approvers approved', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', decision: null },
        { id: 'x2', userId: 'p2', decision: 'APPROVE' },
      ],
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );
    await svcInstance.approve(
      { userId: 'p1', role: 'APPROVER', name: 'P1', department: 'd' } as any,
      'c1',
      { decision: 'APPROVE' } as any,
    );
    expect(state.cr.status).toBe('FINAL_APPROVED');
  });

  it('stays REVIEW_APPROVED on partial approval', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', decision: null },
        { id: 'x2', userId: 'p2', decision: null },
      ],
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );
    await svcInstance.approve(
      { userId: 'p1', role: 'APPROVER', name: 'P1', department: 'd' } as any,
      'c1',
      { decision: 'APPROVE' } as any,
    );
    expect(state.cr.status).toBe('REVIEW_APPROVED');
  });

  it('rejects immediately on any REJECT', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', decision: null },
        { id: 'x2', userId: 'p2', decision: 'APPROVE' },
      ],
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );
    await svcInstance.approve(
      { userId: 'p1', role: 'APPROVER', name: 'P1', department: 'd' } as any,
      'c1',
      { decision: 'REJECT' } as any,
    );
    expect(state.cr.status).toBe('FINAL_REJECTED');
  });

  it('rejects a non-assigned approver (403) and a double decision (409)', async () => {
    const base = () => ({
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [{ id: 'x1', userId: 'p1', decision: null as any }],
    });
    const s1 = base();
    const svc1 = new ChangeRequestService(
      txPrisma(s1) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );
    await expect(
      svc1.approve({ userId: 'nope', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const s2 = base();
    s2.approvers[0].decision = 'APPROVE';
    const svc2 = new ChangeRequestService(
      txPrisma(s2) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );
    await expect(
      svc2.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('delegation integration (부재 위임)', () => {
  it('review: an active delegate reviews on behalf of the assigned reviewer', async () => {
    const delegation = {
      activeDelegatorIds: async () => ['dba'],
      isActiveDelegateFor: async () => true,
    };
    const { service, updateMock, historyMock, findFirstMock, prisma } = makeService(
      { id: 'cr1', status: S.SUBMITTED, authorId: 'u1', reviewerId: 'dba' },
      delegation,
    );
    prisma.user.findUnique = jest.fn().mockResolvedValue({ name: '검토자' });
    findFirstMock.mockResolvedValueOnce({
      id: 'cr1',
      authorId: 'u1',
      author: { name: '개발자' },
      files: [],
      approvers: [],
      statusHistory: [],
    });

    await service.review(actor('del1', Role.REVIEWER), 'cr1', {
      decision: Decision.APPROVE,
      comment: 'ok',
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'cr1' },
      data: { status: S.REVIEW_APPROVED },
    });
    expect(lastHistory(historyMock).comment).toBe('ok (위임: 검토자 대리)');
  });

  it('approve: falls back to a delegator slot and stamps decidedById to the acting delegate', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [{ id: 'x1', userId: 'boss', order: 0, decision: null, user: { name: '보스' } }],
    };
    const delegation = {
      activeDelegatorIds: async () => ['boss'],
      isActiveDelegateFor: async () => true,
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await svcInstance.approve(
      { userId: 'del1', role: 'APPROVER', name: 'D', department: 'd' } as any,
      'c1',
      { decision: 'APPROVE' } as any,
    );

    expect((state.approvers[0] as any).decision).toBe('APPROVE');
    expect((state.approvers[0] as any).decidedById).toBe('del1');
    expect(state.cr.status).toBe('FINAL_APPROVED'); // 1/1 → unanimous
  });

  it('approve: direct slot takes priority over delegation (decidedById stays null)', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', order: 0, decision: null, user: { name: 'P1' } },
        { id: 'x2', userId: 'boss', order: 1, decision: null, user: { name: '보스' } },
      ],
    };
    const delegation = {
      activeDelegatorIds: async () => ['boss'],
      isActiveDelegateFor: async () => true,
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await svcInstance.approve(
      { userId: 'p1', role: 'APPROVER', name: 'P1', department: 'd' } as any,
      'c1',
      { decision: 'APPROVE' } as any,
    );

    expect((state.approvers[0] as any).decision).toBe('APPROVE');
    expect((state.approvers[0] as any).decidedById).toBeNull(); // own slot, not delegated
    expect((state.approvers[1] as any).decision).toBeNull(); // delegator slot untouched
  });

  it('approve: already decided own slot + no open delegator slot → 409', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [{ id: 'x1', userId: 'p1', order: 0, decision: 'APPROVE', user: { name: 'P1' } }],
    };
    const delegation = {
      activeDelegatorIds: async () => ['boss'], // boss has no slot here
      isActiveDelegateFor: async () => true,
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await expect(
      svcInstance.approve(
        { userId: 'p1', role: 'APPROVER' } as any,
        'c1',
        { decision: 'APPROVE' } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('list: APPROVER visibility OR-merges own + delegator slots and passes delegatorIds through', async () => {
    const delegation = {
      activeDelegatorIds: async () => ['boss'],
      isActiveDelegateFor: async () => false,
    };
    const { service, findManyMock } = makeService(undefined, delegation);

    await service.list({ userId: 'del1', role: Role.APPROVER });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { approvers: { some: { userId: 'del1' } } },
            { approvers: { some: { userId: { in: ['boss'] } } } },
          ],
          status: { not: S.DRAFT },
        },
      }),
    );
  });

  it('myApprovalPending: true for an undecided delegator slot at REVIEW_APPROVED, false when not yet REVIEW_APPROVED (Major1 gate)', async () => {
    const delegation = {
      activeDelegatorIds: async () => ['boss'],
      isActiveDelegateFor: async () => false,
    };
    const { service, findManyMock } = makeService(undefined, delegation);
    findManyMock.mockResolvedValueOnce([
      {
        id: 'cr-a',
        status: S.REVIEW_APPROVED,
        authorId: 'u1',
        author: { name: '개발자' },
        reviewer: null,
        approvers: [{ userId: 'boss', decision: null, user: { name: '보스' } }],
      },
      {
        id: 'cr-b',
        status: S.SUBMITTED,
        authorId: 'u1',
        author: { name: '개발자' },
        reviewer: null,
        approvers: [{ userId: 'boss', decision: null, user: { name: '보스' } }],
      },
    ]);

    const rows: any = await service.list({ userId: 'del1', role: Role.APPROVER });

    expect(rows[0].myApprovalPending).toBe(true);
    expect(rows[1].myApprovalPending).toBe(false); // status gate holds even for a delegate
  });
});

describe('SoD guard — one actor fills at most one approver slot per CR', () => {
  it('직접 결재 후 같은 사람의 대리 슬롯 시도 → 409', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', order: 0, decision: 'APPROVE', decidedById: null, user: { name: 'P1' } },
        { id: 'x2', userId: 'p2', order: 1, decision: null, decidedById: null, user: { name: 'P2' } },
      ],
    };
    const delegation = { activeDelegatorIds: async () => ['p2'], isActiveDelegateFor: async () => true };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await expect(
      svcInstance.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((state.approvers[1] as any).decision).toBeNull(); // 대리 슬롯은 손대지 않음
  });

  it('대리로 P2 채운 뒤 같은 사람의 P3 대리 시도 → 409', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p2', order: 0, decision: 'APPROVE', decidedById: 'p1', user: { name: 'P2' } },
        { id: 'x2', userId: 'p3', order: 1, decision: null, decidedById: null, user: { name: 'P3' } },
      ],
    };
    const delegation = {
      activeDelegatorIds: async () => ['p2', 'p3'],
      isActiveDelegateFor: async () => true,
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await expect(
      svcInstance.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((state.approvers[1] as any).decision).toBeNull();
  });

  it('대리로 P2 채운 뒤 같은 사람의 자기 직접 슬롯 시도 → 409', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p2', order: 0, decision: 'APPROVE', decidedById: 'p1', user: { name: 'P2' } },
        { id: 'x2', userId: 'p1', order: 1, decision: null, decidedById: null, user: { name: 'P1' } },
      ],
    };
    const delegation = { activeDelegatorIds: async () => ['p2'], isActiveDelegateFor: async () => true };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await expect(
      svcInstance.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((state.approvers[1] as any).decision).toBeNull(); // 본인 직접 슬롯도 손대지 않음
  });

  it('정상 1건(첫 결재)은 SoD 가드에 막히지 않고 통과한다', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', order: 0, decision: null, decidedById: null, user: { name: 'P1' } },
        { id: 'x2', userId: 'p2', order: 1, decision: null, decidedById: null, user: { name: 'P2' } },
      ],
    };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegationMock,
    );

    await svcInstance.approve(
      { userId: 'p1', role: 'APPROVER', name: 'P1', department: 'd' } as any,
      'c1',
      { decision: 'APPROVE' } as any,
    );

    expect((state.approvers[0] as any).decision).toBe('APPROVE');
    expect(state.cr.status).toBe('REVIEW_APPROVED'); // 1/2만 결재됨 — 아직 최종 승인 아님
  });

  it('SoD 409 메시지는 "이미 결재하셨습니다"와 다르다', async () => {
    const state = {
      cr: { id: 'c1', status: 'REVIEW_APPROVED', authorId: 'a' },
      approvers: [
        { id: 'x1', userId: 'p1', order: 0, decision: 'APPROVE', decidedById: null, user: { name: 'P1' } },
        { id: 'x2', userId: 'p2', order: 1, decision: null, decidedById: null, user: { name: 'P2' } },
      ],
    };
    const delegation = { activeDelegatorIds: async () => ['p2'], isActiveDelegateFor: async () => true };
    const svcInstance = new ChangeRequestService(
      txPrisma(state) as any,
      { buildData: (x: any) => x } as any,
      {} as any,
      delegation as any,
    );

    await expect(
      svcInstance.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.toMatchObject({ response: { key: 'changeRequest.sodViolation' } });
    await expect(
      svcInstance.approve({ userId: 'p1', role: 'APPROVER' } as any, 'c1', { decision: 'APPROVE' } as any),
    ).rejects.not.toMatchObject({ response: { key: 'changeRequest.alreadyDecided' } });
  });

  describe('toDetail: iAlreadyActed / canActAsDelegate gating', () => {
    it('이미 결정/대리한 뷰어 → canActAsDelegate=false, iAlreadyActed=true', async () => {
      const delegation = { activeDelegatorIds: async () => ['boss'], isActiveDelegateFor: async () => false };
      const { service, findFirstMock } = makeService(undefined, delegation);
      findFirstMock.mockResolvedValueOnce({
        id: 'cr1',
        status: S.REVIEW_APPROVED,
        authorId: 'u1',
        reviewerId: null,
        author: { name: '개발자' },
        reviewer: null,
        files: [],
        statusHistory: [],
        approvers: [
          {
            userId: 'p1',
            order: 0,
            decision: 'APPROVE',
            comment: null,
            decidedAt: new Date(),
            decidedById: null,
            decidedBy: null,
            user: { name: 'P1' },
          },
          {
            userId: 'boss',
            order: 1,
            decision: null,
            comment: null,
            decidedAt: null,
            decidedById: null,
            decidedBy: null,
            user: { name: '보스' },
          },
        ],
      });

      const detail: any = await service.findOne({ userId: 'p1', role: Role.APPROVER }, 'cr1');

      expect(detail.iAlreadyActed).toBe(true);
      expect(detail.canActAsDelegate).toBe(false);
    });

    it('아직 안 한 활성 대리인 → canActAsDelegate=true, iAlreadyActed=false', async () => {
      const delegation = { activeDelegatorIds: async () => ['boss'], isActiveDelegateFor: async () => false };
      const { service, findFirstMock } = makeService(undefined, delegation);
      findFirstMock.mockResolvedValueOnce({
        id: 'cr1',
        status: S.REVIEW_APPROVED,
        authorId: 'u1',
        reviewerId: null,
        author: { name: '개발자' },
        reviewer: null,
        files: [],
        statusHistory: [],
        approvers: [
          {
            userId: 'boss',
            order: 0,
            decision: null,
            comment: null,
            decidedAt: null,
            decidedById: null,
            decidedBy: null,
            user: { name: '보스' },
          },
        ],
      });

      const detail: any = await service.findOne({ userId: 'del1', role: Role.APPROVER }, 'cr1');

      expect(detail.iAlreadyActed).toBe(false);
      expect(detail.canActAsDelegate).toBe(true);
    });
  });
});

describe('inbox — 내가 지금 결정할 수 있는 것만', () => {
  const submitted = {
    id: 'cr-s', status: ChangeRequestStatus.SUBMITTED, authorId: 'u-dev',
    reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date('2026-07-01'),
    author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' }, approvers: [],
  };
  const reviewApproved = {
    id: 'cr-a', status: ChangeRequestStatus.REVIEW_APPROVED, authorId: 'u-dev',
    reviewerId: 'u-rev', createdAt: new Date(), updatedAt: new Date('2026-07-02'),
    author: { name: '개발자' }, reviewer: { name: '검토자', department: 'DBA' },
    approvers: [{ userId: 'u-appr', decision: null, decidedById: null, user: { name: '결재자' } }],
  };

  it('REVIEWER에게 SUBMITTED만 준다 — 다른 상태 행을 섞어도 걸러진다', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([submitted, reviewApproved]);
    const rows = await service.inbox({ userId: 'u-rev', role: Role.REVIEWER } as any);
    expect(rows.map((r) => r.id)).toEqual(['cr-s']);
  });

  it('updatedAt 오름차순을 쿼리 인자로 요구한다', async () => {
    // 이 스위트의 findMany mock은 orderBy를 무시하므로 결과 순서를 단언하면 픽스처를 검사하는 셈이다.
    const { service, findManyMock } = makeService();
    await service.inbox({ userId: 'u-rev', role: Role.REVIEWER } as any);
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ updatedAt: 'asc' });
  });

  it('APPROVER에게 myApprovalPending 항목을 준다', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([submitted, reviewApproved]);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows.map((r) => r.id)).toEqual(['cr-a']);
  });

  it('SoD로 막힐 항목은 인박스에 없다 — 내가 다른 슬롯을 이미 결재한 경우', async () => {
    // myApprovalPending은 true이지만 approve()가 409로 거부하므로 인박스에 떠서는 안 된다.
    const { service, findManyMock } = makeService(undefined, {
      activeDelegatorIds: async () => ['u-other'],
      isActiveDelegateFor: async () => false,
    });
    findManyMock.mockResolvedValue([
      {
        ...reviewApproved,
        approvers: [
          { userId: 'u-appr', decision: 'APPROVE', decidedById: null, user: { name: '결재자' } },
          { userId: 'u-other', decision: null, decidedById: null, user: { name: '위임자' } },
        ],
      },
    ]);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows).toEqual([]);
  });

  it('SoD로 막힐 항목은 인박스에 없다 — 내가 다른 슬롯을 대리 결재한 경우', async () => {
    const { service, findManyMock } = makeService();
    findManyMock.mockResolvedValue([
      {
        ...reviewApproved,
        approvers: [
          { userId: 'u-x', decision: 'APPROVE', decidedById: 'u-appr', user: { name: '타인' } },
          { userId: 'u-appr', decision: null, decidedById: null, user: { name: '결재자' } },
        ],
      },
    ]);
    const rows = await service.inbox({ userId: 'u-appr', role: Role.APPROVER } as any);
    expect(rows).toEqual([]);
  });

  it('DEVELOPER·ADMIN에게는 빈 배열이고 Prisma를 호출하지 않는다', async () => {
    for (const role of [Role.DEVELOPER, Role.ADMIN]) {
      const { service, findManyMock } = makeService();
      const rows = await service.inbox({ userId: 'u-x', role } as any);
      expect(rows).toEqual([]);
      expect(findManyMock).not.toHaveBeenCalled();
    }
  });
});
