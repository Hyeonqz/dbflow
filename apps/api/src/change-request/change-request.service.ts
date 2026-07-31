import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalDecision,
  AuditAction,
  AuditTargetType,
  ChangeRequestStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ApprovalPolicyService } from '../approval-policy/approval-policy.service';
import { AuditService } from '../audit/audit.service';
import { DelegationService } from '../delegation/delegation.service';
import { CurrentUserPayload } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { Decision, DecisionDto } from './dto/decision.dto';
import { getNextStatus, TransitionAction } from './change-request.state-machine';

export interface AuthUser {
  userId: string;
  role: Role;
}

/** Non-APPLY transitions driven through `applyTransition` (APPLY is handled by the apply engine). */
type CrTransitionAction = Exclude<TransitionAction, 'APPLY'>;

const AUDIT_ACTION_BY_TRANSITION: Record<CrTransitionAction, AuditAction> = {
  SUBMIT: AuditAction.CR_SUBMITTED,
  REVIEW_APPROVE: AuditAction.CR_REVIEWED,
  REVIEW_REJECT: AuditAction.CR_REVIEWED,
  FINAL_APPROVE: AuditAction.CR_APPROVED,
  FINAL_REJECT: AuditAction.CR_APPROVED,
};
const AUDIT_SUMMARY: Record<CrTransitionAction, string> = {
  SUBMIT: '제출',
  REVIEW_APPROVE: '검토 승인',
  REVIEW_REJECT: '검토 반려',
  FINAL_APPROVE: '최종 승인',
  FINAL_REJECT: '최종 반려',
};

const DETAIL_INCLUDE = {
  files: { orderBy: { order: 'asc' } },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true } } },
  },
  author: { select: { name: true } },
  reviewer: { select: { name: true, department: true } },
  approvers: {
    orderBy: { order: 'asc' },
    select: {
      userId: true,
      order: true,
      decision: true,
      comment: true,
      decidedAt: true,
      decidedById: true,
      decidedBy: { select: { name: true } },
      user: { select: { name: true, department: true } },
    },
  },
} satisfies Prisma.ChangeRequestInclude;

const SUMMARY_SELECT = {
  id: true,
  title: true,
  targetEnv: true,
  status: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { name: true } },
  reviewerId: true,
  reviewer: { select: { name: true, department: true } },
  approvers: {
    orderBy: { order: 'asc' },
    // decidedById는 alreadyActed 판정에만 쓰이고 toSummary가 응답에 내보내지 않는다.
    select: { userId: true, decision: true, decidedById: true, user: { select: { name: true } } },
  },
} satisfies Prisma.ChangeRequestSelect;

type DetailPayload = Prisma.ChangeRequestGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type SummaryPayload = Prisma.ChangeRequestGetPayload<{ select: typeof SUMMARY_SELECT }>;

@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ApprovalPolicyService,
    private readonly delegation: DelegationService,
  ) {}

  async create(actor: CurrentUserPayload, dto: CreateChangeRequestDto) {
    await this.assertAssigneeRoles(dto.reviewerId, dto.approverIds);
    const created = await this.prisma.changeRequest.create({
      data: {
        title: dto.title,
        description: dto.description,
        targetEnv: dto.targetEnv,
        authorId: actor.userId,
        reviewerId: dto.reviewerId ?? null,
        approvers: {
          create: (dto.approverIds ?? []).map((userId, i) => ({ userId, order: i })),
        },
        files: {
          create: dto.files.map((file, index) => ({
            filename: file.filename,
            sqlType: file.sqlType,
            content: file.content,
            order: index,
          })),
        },
      },
      include: DETAIL_INCLUDE,
    });
    await this.audit.record({
      actor,
      action: AuditAction.CR_CREATED,
      targetType: AuditTargetType.CHANGE_REQUEST,
      targetId: created.id,
      summary: '변경요청 생성',
      metadata: { targetEnv: dto.targetEnv, reviewerId: dto.reviewerId, approverIds: dto.approverIds },
    });
    return this.toDetail(created);
  }

  async list(user: AuthUser) {
    const delegatorIds = await this.delegatorIdsFor(user);
    const rows = await this.prisma.changeRequest.findMany({
      where: this.visibilityWhere(user, delegatorIds),
      orderBy: { createdAt: 'desc' },
      select: SUMMARY_SELECT,
    });
    return rows.map((row) => this.toSummary(row, user.userId, delegatorIds));
  }

  /**
   * "내가 지금 결정할 수 있는 것" 목록. 오래 기다린 순.
   * 필터를 toSummary 뒤에 두는 이유: myApprovalPending을 재구현하지 않고 그대로 써야
   * KPI 카드가 세는 집합과 갈라지지 않는다. SQL로 옮기면 두 판정이 분기한다.
   */
  async inbox(user: AuthUser) {
    // DEVELOPER·ADMIN은 결정할 것이 없다. visibilityWhere의 기본 분기는 실제 쿼리이므로 왕복을 아낀다.
    if (user.role !== Role.REVIEWER && user.role !== Role.APPROVER) return [];
    const delegatorIds = await this.delegatorIdsFor(user);
    const rows = await this.prisma.changeRequest.findMany({
      where: this.visibilityWhere(user, delegatorIds),
      orderBy: { updatedAt: 'asc' },
      select: SUMMARY_SELECT,
    });
    return rows
      .map((row) => ({ row, summary: this.toSummary(row, user.userId, delegatorIds) }))
      .filter(({ row, summary }) =>
        user.role === Role.REVIEWER
          ? summary.status === ChangeRequestStatus.SUBMITTED
          : summary.myApprovalPending && !this.alreadyActed(row.approvers, user.userId),
      )
      .map(({ summary }) => summary);
  }

  async findOne(user: AuthUser, id: string) {
    const delegatorIds = await this.delegatorIdsFor(user);
    const changeRequest = await this.prisma.changeRequest.findFirst({
      where: { id, ...this.visibilityWhere(user, delegatorIds) },
      include: DETAIL_INCLUDE,
    });
    if (!changeRequest) {
      throw new NotFoundException({ key: 'changeRequest.notFound' });
    }
    // 결재자별 루프가 아니라 단일 쿼리. 겹치는 위임이 가능하므로 orderBy로 결정적으로 고른다.
    const approverIds = changeRequest.approvers.map((a) => a.userId);
    const now = new Date();
    const activeDelegations = approverIds.length
      ? await this.prisma.delegation.findMany({
          where: { delegatorId: { in: approverIds }, startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
          select: { delegatorId: true, delegate: { select: { name: true } } },
        })
      : [];
    const delegateNameByDelegatorId = new Map<string, string>();
    for (const d of activeDelegations) {
      if (!delegateNameByDelegatorId.has(d.delegatorId) && d.delegate?.name) {
        delegateNameByDelegatorId.set(d.delegatorId, d.delegate.name);
      }
    }
    return this.toDetail(changeRequest, user.userId, delegatorIds, delegateNameByDelegatorId);
  }

  /** critic Minor4 — only reviewers/approvers can act as delegates; others short-circuit. */
  private async delegatorIdsFor(user: AuthUser): Promise<string[]> {
    if (user.role !== Role.REVIEWER && user.role !== Role.APPROVER) return [];
    return this.delegation.activeDelegatorIds(user.userId);
  }

  async submit(actor: CurrentUserPayload, id: string) {
    const changeRequest = await this.getOrThrow(id);
    if (changeRequest.authorId !== actor.userId) {
      throw new ForbiddenException({ key: 'changeRequest.submitAuthorOnly' });
    }
    const required = await this.policy.getRequired(changeRequest.targetEnv);
    const count = await this.prisma.changeRequestApprover.count({ where: { changeRequestId: id } });
    if (!changeRequest.reviewerId || count !== required) {
      throw new BadRequestException({ key: 'changeRequest.submitRequiresAssignees', args: { required } });
    }
    return this.applyTransition(changeRequest, 'SUBMIT', actor, null);
  }

  async review(actor: CurrentUserPayload, id: string, dto: DecisionDto) {
    const action: CrTransitionAction =
      dto.decision === Decision.APPROVE ? 'REVIEW_APPROVE' : 'REVIEW_REJECT';
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
      const cr = await tx.changeRequest.findUnique({
        where: { id },
        select: { id: true, status: true, reviewerId: true },
      });
      if (!cr) throw new NotFoundException({ key: 'changeRequest.notFound' });
      const rid = cr.reviewerId;
      const isDirect = rid === actor.userId;
      const isDelegate =
        !isDirect && !!rid && (await this.delegation.isActiveDelegateFor(actor.userId, rid));
      if (!isDirect && !isDelegate)
        throw new ForbiddenException({ key: 'changeRequest.reviewForbidden' });
      const toStatus = getNextStatus(cr.status, action); // 이미 전이됨이면 throw → 이중 검토 차단
      const delegatorName = isDelegate
        ? (await tx.user.findUnique({ where: { id: rid! }, select: { name: true } }))?.name ?? null
        : null;
      await tx.changeRequest.update({ where: { id }, data: { status: toStatus } });
      await tx.statusHistory.create({
        data: {
          changeRequestId: id,
          fromStatus: cr.status,
          toStatus,
          actorId: actor.userId,
          comment: this.withDelegateNote(dto.comment, delegatorName),
        },
      });
      await tx.auditLog.create({
        data: this.audit.buildData({
          actor,
          action: AuditAction.CR_REVIEWED,
          targetType: AuditTargetType.CHANGE_REQUEST,
          targetId: id,
          summary: `검토 ${action === 'REVIEW_APPROVE' ? '승인' : '반려'} (CR ${id})`,
          metadata: {
            fromStatus: cr.status,
            toStatus,
            comment: dto.comment ?? undefined,
            onBehalfOf: isDelegate ? rid : undefined,
          },
        }),
      });
    });
    return this.findOne(actor, id);
  }

  /** Appends a "(위임: X 대리)" suffix to the comment when acting as a delegate. */
  private withDelegateNote(
    comment: string | null | undefined,
    delegatorName: string | null,
  ): string | null {
    const base = comment ?? null;
    if (!delegatorName) return base;
    return `${base ? base + ' ' : ''}(위임: ${delegatorName} 대리)`;
  }

  async approve(actor: CurrentUserPayload, id: string, dto: DecisionDto) {
    // 대리 위임자 목록은 CR 행 잠금 밖에서 읽는다(위임 테이블은 CR과 무관).
    const delegatorIds = await this.delegation.activeDelegatorIds(actor.userId);
    const authorId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`;
      const cr = await tx.changeRequest.findUnique({
        where: { id },
        select: { id: true, status: true, authorId: true },
      });
      if (!cr) throw new NotFoundException({ key: 'changeRequest.notFound' });
      if (cr.status !== ChangeRequestStatus.REVIEW_APPROVED)
        throw new ConflictException({
          key: 'changeRequest.approveInvalidStatus',
          args: { status: cr.status },
        });
      const mine = await tx.changeRequestApprover.findUnique({
        where: { changeRequestId_userId: { changeRequestId: id, userId: actor.userId } },
      });
      let slot = mine && mine.decision === null ? mine : null;
      let onBehalfOf: string | null = null;
      let delegatorName: string | null = null;
      if (!slot && delegatorIds.length) {
        const del = await tx.changeRequestApprover.findFirst({
          where: { changeRequestId: id, userId: { in: delegatorIds }, decision: null },
          orderBy: { order: 'asc' },
          include: { user: { select: { name: true } } },
        });
        if (del) {
          slot = del;
          onBehalfOf = del.userId;
          delegatorName = del.user?.name ?? null;
        }
      }
      if (!slot) {
        if (mine && mine.decision !== null)
          throw new ConflictException({ key: 'changeRequest.alreadyDecided' });
        throw new ForbiddenException({ key: 'changeRequest.approveForbidden' });
      }

      // 직무분리(SoD): 한 사람이 직접·대리를 합쳐 한 CR에 최대 한 슬롯만 채울 수 있다.
      const priorByActor = await tx.changeRequestApprover.findFirst({
        where: {
          changeRequestId: id,
          id: { not: slot.id },
          OR: [
            { userId: actor.userId, decision: { not: null } },
            { decidedById: actor.userId },
          ],
        },
        select: { id: true },
      });
      if (priorByActor) {
        throw new ConflictException({ key: 'changeRequest.sodViolation' });
      }

      const decision: ApprovalDecision =
        dto.decision === Decision.APPROVE ? ApprovalDecision.APPROVE : ApprovalDecision.REJECT;
      await tx.changeRequestApprover.update({
        where: { id: slot.id },
        data: {
          decision,
          comment: dto.comment ?? null,
          decidedAt: new Date(),
          decidedById: onBehalfOf ? actor.userId : null,
        },
      });

      const all = await tx.changeRequestApprover.findMany({
        where: { changeRequestId: id },
        select: { decision: true },
      });
      const approved = all.filter((a) => a.decision === ApprovalDecision.APPROVE).length;
      const progress = `${approved}/${all.length}`;
      const transition: CrTransitionAction | null =
        decision === ApprovalDecision.REJECT
          ? 'FINAL_REJECT'
          : approved === all.length
            ? 'FINAL_APPROVE'
            : null;

      if (transition) {
        const toStatus = getNextStatus(cr.status, transition);
        await tx.changeRequest.update({ where: { id }, data: { status: toStatus } });
        await tx.statusHistory.create({
          data: {
            changeRequestId: id,
            fromStatus: cr.status,
            toStatus,
            actorId: actor.userId,
            comment: this.withDelegateNote(dto.comment, delegatorName),
          },
        });
      }
      await tx.auditLog.create({
        data: this.audit.buildData({
          actor,
          action: AuditAction.CR_APPROVED,
          targetType: AuditTargetType.CHANGE_REQUEST,
          targetId: id,
          summary:
            transition === 'FINAL_APPROVE'
              ? `최종 승인 (CR ${id})`
              : transition === 'FINAL_REJECT'
                ? `최종 반려 (CR ${id})`
                : `결재 진행 ${progress} (CR ${id})`,
          metadata: {
            decision,
            progress,
            comment: dto.comment ?? undefined,
            delegatedFrom: onBehalfOf ?? undefined,
          },
        }),
      });
      return cr.authorId;
    });
    return this.findOne({ userId: authorId, role: Role.DEVELOPER }, id);
  }

  // --- internals -----------------------------------------------------------

  /** spec §4.2 — 지정된 검토자/결재자가 실제로 해당 역할을 가졌는지 검증. */
  private async assertAssigneeRoles(reviewerId?: string | null, approverIds?: string[] | null) {
    if (reviewerId) {
      const r = await this.prisma.user.findUnique({
        where: { id: reviewerId },
        select: { role: true },
      });
      if (!r || r.role !== Role.REVIEWER)
        throw new BadRequestException({ key: 'changeRequest.reviewerMustBeReviewerRole' });
    }
    if (approverIds && approverIds.length) {
      if (new Set(approverIds).size !== approverIds.length)
        throw new BadRequestException({ key: 'changeRequest.duplicateApprovers' });
      const rows = await this.prisma.user.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, role: true },
      });
      if (rows.length !== approverIds.length || rows.some((u) => u.role !== Role.APPROVER))
        throw new BadRequestException({ key: 'changeRequest.approversMustBeApproverRole' });
    }
  }

  private async getOrThrow(id: string) {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id },
      select: { id: true, status: true, authorId: true, reviewerId: true, targetEnv: true },
    });
    if (!changeRequest) {
      throw new NotFoundException({ key: 'changeRequest.notFound' });
    }
    return changeRequest;
  }

  /**
   * Validates the transition via the state machine, then atomically updates the
   * status and appends a StatusHistory entry. Returns the refreshed detail view.
   */
  private async applyTransition(
    changeRequest: { id: string; status: ChangeRequestStatus },
    action: CrTransitionAction,
    actor: CurrentUserPayload,
    comment: string | null,
  ) {
    const toStatus = getNextStatus(changeRequest.status, action);
    await this.prisma.$transaction([
      this.prisma.changeRequest.update({
        where: { id: changeRequest.id },
        data: { status: toStatus },
      }),
      this.prisma.statusHistory.create({
        data: {
          changeRequestId: changeRequest.id,
          fromStatus: changeRequest.status,
          toStatus,
          actorId: actor.userId,
          comment,
        },
      }),
      this.prisma.auditLog.create({
        data: this.audit.buildData({
          actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
          action: AUDIT_ACTION_BY_TRANSITION[action],
          targetType: AuditTargetType.CHANGE_REQUEST,
          targetId: changeRequest.id,
          summary: `${AUDIT_SUMMARY[action]} (CR ${changeRequest.id})`,
          metadata: { fromStatus: changeRequest.status, toStatus, comment: comment ?? undefined },
        }),
      }),
    ]);
    const refreshed = await this.prisma.changeRequest.findUniqueOrThrow({
      where: { id: changeRequest.id },
      include: DETAIL_INCLUDE,
    });
    return this.toDetail(refreshed);
  }

  /**
   * 위임을 통해서만 내 범위에 든 항목의 위임자 이름. 내 것이면 null.
   * 역할이 아니라 delegatorIds로 판정하는 이유: 이 필드는 모든 역할이 같은 코드 경로로 받는
   * 요약 타입에 붙는다. 역할별 규칙으로 쓰면 개발자 자신의 CR이 전부 "위임"으로 표시된다.
   * delegatorIds는 REVIEWER·APPROVER가 아닌 역할에 []이므로 구조적으로 null이 된다.
   */
  private delegatedFromFor(
    row: SummaryPayload,
    currentUserId: string,
    delegatorIds: string[],
  ): string | null {
    if (!delegatorIds.length) return null;
    if (row.status === ChangeRequestStatus.SUBMITTED) {
      return delegatorIds.includes(row.reviewerId ?? '') ? (row.reviewer?.name ?? null) : null;
    }
    if (row.status === ChangeRequestStatus.REVIEW_APPROVED) {
      // approve()와 같은 우선순위: 자기 미결정 슬롯이 있으면 그것으로 결재하므로 위임이 아니다.
      if (row.approvers.some((a) => a.userId === currentUserId && a.decision === null)) return null;
      const viaDelegation = row.approvers.find(
        (a) => delegatorIds.includes(a.userId) && a.decision === null,
      );
      return viaDelegation?.user?.name ?? null;
    }
    return null;
  }

  /** Flattens the joined author/reviewer names and approver decisions onto a summary row. */
  private toSummary(row: SummaryPayload, currentUserId: string, delegatorIds: string[] = []) {
    const { author, reviewer, approvers, ...rest } = row;
    const approved = approvers.filter((a) => a.decision === 'APPROVE').length;
    return {
      ...rest,
      authorName: author?.name ?? null,
      reviewerName: reviewer?.name ?? null,
      approverNames: approvers.map((a) => a.user?.name ?? null),
      approvalProgress: { approved, required: approvers.length },
      myApprovalPending:
        rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
        approvers.some(
          (a) =>
            (a.userId === currentUserId || delegatorIds.includes(a.userId)) && a.decision === null,
        ),
      delegatedFrom: this.delegatedFromFor(row, currentUserId, delegatorIds),
    };
  }

  /**
   * 이 사용자가 이 CR에서 이미 결정했는지(직접 또는 대리).
   * approve()의 SoD 게이트가 두 번째 결재를 409로 거부하므로, 인박스는 이 술어로 걸러야 한다.
   * toDetail의 iAlreadyActed와 동일 판정 — 두 곳이 갈라지지 않게 여기 하나만 둔다.
   */
  private alreadyActed(
    approvers: { userId: string; decision: unknown; decidedById: string | null }[],
    // string | undefined여야 한다. toDetail의 currentUserId는 optional이고 create()·
    // applyTransition()이 actor 없이 호출하므로, required로 바꾸거나 `!`·`?? ''`로 우회하면
    // 그 두 경로의 iAlreadyActed가 뒤집힌다. 단, 이를 직접 잡아주는 테스트는 없다 —
    // 기존 iAlreadyActed 단언(change-request.service.spec.ts의 "toDetail: iAlreadyActed /
    // canActAsDelegate gating")은 currentUserId가 있는 findOne() 경로만 검증한다.
    currentUserId?: string,
  ): boolean {
    return (
      approvers.some((a) => a.userId === currentUserId && a.decision !== null) ||
      approvers.some((a) => a.decidedById === currentUserId)
    );
  }

  /** Flattens denormalized author/reviewer/approver/actor display names for the detail view. */
  private toDetail(
    changeRequest: DetailPayload,
    currentUserId?: string,
    delegatorIds: string[] = [],
    delegateNameByDelegatorId: Map<string, string> = new Map(),
  ) {
    const { author, reviewer, approvers, statusHistory, ...rest } = changeRequest;
    const actorAlreadyActed = this.alreadyActed(approvers, currentUserId);
    return {
      ...rest,
      authorName: author?.name ?? null,
      reviewerName: reviewer?.name ?? null,
      approvers: approvers.map((a) => ({
        userId: a.userId,
        name: a.user?.name ?? null,
        department: a.user?.department ?? null,
        order: a.order,
        decision: a.decision,
        comment: a.comment,
        decidedAt: a.decidedAt,
        decidedBy: a.decidedBy?.name ?? null,
        // 결정 전 위임 표시. 결정 후의 대리 표시는 위 decidedBy가 담당한다.
        delegatedTo: delegateNameByDelegatorId.get(a.userId) ?? null,
      })),
      iAlreadyActed: actorAlreadyActed,
      canActAsDelegate:
        !actorAlreadyActed &&
        ((rest.status === ChangeRequestStatus.SUBMITTED &&
          !!delegatorIds.length &&
          delegatorIds.includes(rest.reviewerId ?? '')) ||
        (rest.status === ChangeRequestStatus.REVIEW_APPROVED &&
          approvers.some((a) => delegatorIds.includes(a.userId) && a.decision === null))),
      statusHistory: statusHistory.map((history) => {
        const { actor, ...entry } = history;
        return { ...entry, actorName: actor?.name ?? null };
      }),
    };
  }

  /** Role-based visibility filter — see docs/plan2-api-contract.md §3.2 / spec §4.2. */
  private visibilityWhere(
    user: AuthUser,
    delegatorIds: string[] = [],
  ): Prisma.ChangeRequestWhereInput {
    switch (user.role) {
      case Role.DEVELOPER:
        return { authorId: user.userId };
      case Role.REVIEWER:
        return {
          OR: [{ reviewerId: user.userId }, { reviewerId: { in: delegatorIds } }],
          status: { not: ChangeRequestStatus.DRAFT },
        };
      case Role.APPROVER:
        return {
          OR: [
            { approvers: { some: { userId: user.userId } } },
            { approvers: { some: { userId: { in: delegatorIds } } } },
          ],
          status: { not: ChangeRequestStatus.DRAFT },
        };
      default:
        // ADMIN 및 미지정 역할은 목록에서 아무것도 못 봄(관리자는 /users 사용).
        return { id: { equals: '' } };
    }
  }

  /**
   * Reassigns the reviewer/approver. Allowed while DRAFT (author only) or at
   * any time by an ADMIN. Returns the refreshed detail, read via the author's
   * visibility context since ADMIN visibility sees nothing (see visibilityWhere).
   */
  async setAssignees(
    user: CurrentUserPayload,
    id: string,
    dto: { reviewerId?: string; approverIds?: string[] },
  ) {
    const cr = await this.getOrThrow(id);
    const isDraft = cr.status === ChangeRequestStatus.DRAFT;
    const allowed = (isDraft && cr.authorId === user.userId) || user.role === Role.ADMIN;
    if (!allowed) {
      throw new ForbiddenException({ key: 'changeRequest.assigneesChangeForbidden' });
    }
    await this.assertAssigneeRoles(dto.reviewerId, dto.approverIds);
    if (dto.approverIds !== undefined && !isDraft) {
      const required = await this.policy.getRequired(cr.targetEnv);
      if (dto.approverIds.length !== required) {
        throw new BadRequestException({
          key: 'changeRequest.approverCountMismatch',
          args: { required },
        });
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.reviewerId !== undefined)
        await tx.changeRequest.update({ where: { id }, data: { reviewerId: dto.reviewerId } });
      if (dto.approverIds !== undefined) {
        await tx.changeRequestApprover.deleteMany({ where: { changeRequestId: id } });
        await tx.changeRequestApprover.createMany({
          data: dto.approverIds.map((userId, i) => ({ changeRequestId: id, userId, order: i })),
        });
      }
    });
    await this.audit.record({
      actor: user,
      action: AuditAction.CR_ASSIGNEES_CHANGED,
      targetType: AuditTargetType.CHANGE_REQUEST,
      targetId: id,
      summary: '지정자 변경',
      metadata: { reviewerId: dto.reviewerId, approverIds: dto.approverIds },
    });
    return this.findOne({ userId: cr.authorId, role: Role.DEVELOPER }, id);
  }
}
