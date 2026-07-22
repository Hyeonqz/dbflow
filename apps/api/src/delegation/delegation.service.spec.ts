import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

const TUE = new Date(2026, 6, 21, 3, 0, 0); // 화 03:00 KST

function svc(overrides: any = {}) {
  const prisma: any = {
    delegation: {
      findMany: overrides.findMany ?? (() => Promise.resolve([])),
      findFirst: overrides.findFirst ?? (() => Promise.resolve(null)),
      findUnique: overrides.findUnique ?? (() => Promise.resolve(null)),
      create: overrides.create ?? ((a: any) => Promise.resolve({ id: 'd1', ...a.data })),
      delete: overrides.delete ?? (() => Promise.resolve({})),
    },
    user: { findMany: overrides.users ?? (() => Promise.resolve([])) },
  };
  const audit = { record: overrides.record ?? (() => Promise.resolve()) };
  return new DelegationService(prisma as any, audit as any);
}

describe('DelegationService.activeDelegatorIds', () => {
  it('returns delegatorIds for active windows only', async () => {
    const s = svc({ findMany: ({ where }: any) => {
      // 검증: where.delegateId, startsAt.lte, endsAt.gt 형태
      expect(where.delegateId).toBe('Y');
      return Promise.resolve([{ delegatorId: 'X1' }, { delegatorId: 'X2' }]);
    }});
    expect(await s.activeDelegatorIds('Y')).toEqual(['X1', 'X2']);
  });
});

describe('DelegationService.createDelegation', () => {
  const admin = { userId: 'adm', name: 'A', role: 'ADMIN', department: '운영팀' };
  const appr = { userId: 'X', name: 'X', role: 'APPROVER', department: 'infra' };

  it('rejects self-delegation', async () => {
    await expect(svc().createDelegation(
      { delegateId: 'X', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects role mismatch (delegate not same role)', async () => {
    const s = svc({ users: () => Promise.resolve([
      { id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'REVIEWER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toThrow(/같은 역할/);
  });

  it('rejects startsAt >= endsAt', async () => {
    const s = svc({ users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-02T00:00', endsAt: '2026-07-01T00:00' } as any, appr as any,
    )).rejects.toThrow(/시작/);
  });

  it('non-admin forces delegatorId to self and converts KST', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'SOMEONE_ELSE', delegateId: 'Y', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00' } as any,
      appr as any,
    );
    expect(created.delegatorId).toBe('X');          // self 강제(비-ADMIN)
    expect(created.startsAt.toISOString()).toBe('2026-09-29T15:00:00.000Z'); // KST 00:00
  });

  it('admin may set delegatorId to another user', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'X', delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any,
      admin as any,
    );
    expect(created.delegatorId).toBe('X');
    expect(created.createdById).toBe('adm');
  });
});

describe('DelegationService.deleteDelegation', () => {
  it('forbids a non-owner non-admin', async () => {
    const s = svc({ findUnique: () => Promise.resolve({ id: 'd1', delegatorId: 'X', delegateId: 'Y' }) });
    await expect(s.deleteDelegation('d1', { userId: 'Z', role: 'APPROVER' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
