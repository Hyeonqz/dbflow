import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditOutcome,
  AuditTargetType,
  ChangeRequestStatus,
  ExecutionStatus,
  Prisma,
  TargetDatabase,
  TargetEnv,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../crypto/encryption.util';
import { getNextStatus } from '../change-request/change-request.state-machine';
import { openTargetConnection } from '../target-database/target-connection';
import { runSqlFile } from './sql-runner';
import { ApplyDto } from './dto/apply.dto';
import { assertApplyPermission, assertEnvMatch, SafetyActor } from './apply-policy';
import { hasBlock, lintFiles, LintResult } from './lint.engine';
import { BackupService } from './backup.service';
import { AuditService } from '../audit/audit.service';
import { SqlReviewService } from '../sql-review/sql-review.service';
import { ApplyScheduleService } from '../apply-schedule/apply-schedule.service';

export type ApplyActor = SafetyActor;

const EXECUTION_INCLUDE = {
  steps: { orderBy: { order: 'asc' } },
} satisfies Prisma.ExecutionInclude;

/** CR statuses from which a DEV target may NOT be applied (contract §4.2 step 4). */
const DEV_BLOCKED_STATUSES: readonly ChangeRequestStatus[] = [
  ChangeRequestStatus.REVIEW_REJECTED,
  ChangeRequestStatus.FINAL_REJECTED,
  ChangeRequestStatus.APPLIED,
];

type FileToRun = { filename: string; content: string; order: number };

@Injectable()
export class ApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    private readonly audit: AuditService,
    private readonly sqlReview: SqlReviewService,
    private readonly schedule: ApplyScheduleService,
  ) {}

  /**
   * Applies a change request's SQL files to a target database. See
   * docs/plan3-apply-contract.md §4.2 for the full procedure. The HTTP layer
   * always returns 200 with the Execution detail; success/failure is read from
   * `status`.
   */
  async apply(actor: ApplyActor, changeRequestId: string, dto: ApplyDto) {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id: changeRequestId },
      include: { files: { orderBy: { order: 'asc' } } },
    });
    if (!changeRequest) {
      throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    }

    const target = await this.prisma.targetDatabase.findUnique({
      where: { id: dto.targetDatabaseId },
    });
    if (!target) {
      throw new NotFoundException('대상 데이터베이스를 찾을 수 없습니다.');
    }

    // 2. Environment match.
    assertEnvMatch(changeRequest.targetEnv, target.env);

    // 3. Environment-based RBAC (guard already allowed DEVELOPER|APPROVER).
    assertApplyPermission(actor, target.env, changeRequest.authorId);

    // 4. Approval gate.
    this.assertApprovalGate(target.env, changeRequest.status);

    // 4.2 Time gate: apply window / freeze (스펙 §5). lint/dry-run/rollback은 비게이트.
    await this.schedule.assertApplyAllowed(target.env);

    // MVP executes MYSQL targets only.
    if (target.dbType !== 'MYSQL') {
      throw new ConflictException('MVP는 MYSQL 대상만 적용을 지원합니다.');
    }

    // 4.5 Risky-SQL lint gate (env-aware). STAGING/PROD block on effective BLOCK;
    // DEV downgrades BLOCK→WARN and proceeds. No execution/backup is created here.
    const policy = await this.sqlReview.getPolicyMap(target.env);
    const lint = lintFiles(changeRequest.files, policy);
    if (hasBlock(lint)) {
      const blocked = lint.items.filter((i) => i.severity === 'BLOCK');
      throw new ConflictException(
        `위험 SQL(BLOCK)이 감지되어 적용을 거부합니다: ${blocked
          .map((i) => `${i.filename}:${i.rule}`)
          .join(', ')}`,
      );
    }

    // 5. Concurrency guard + RUNNING execution creation, serialized via row lock.
    const execution = await this.startExecution(changeRequest.id, target.id, actor.userId);

    // 5.5 Automatic pre-apply backup. No backup → no apply (safety first).
    try {
      const backup = await this.backups.createBackup({
        changeRequestId: changeRequest.id,
        target,
        files: changeRequest.files,
      });
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: { backupId: backup.id },
      });
    } catch (err) {
      await this.prisma.executionStep.create({
        data: {
          executionId: execution.id,
          filename: '(backup)',
          order: 0,
          status: ExecutionStatus.FAILED,
          error: `백업 생성 실패로 적용을 중단했습니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      });
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: { status: ExecutionStatus.FAILED, finishedAt: new Date() },
      });
      return this.auditApplyOutcome(actor, changeRequestId, execution.id);
    }

    // 6/7. Run files sequentially, stopping at the first failure.
    const failed = await this.runFiles(execution.id, target, changeRequest.files);

    // 8. Finalize.
    if (failed) {
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: { status: ExecutionStatus.FAILED, finishedAt: new Date() },
      });
    } else {
      await this.finalizeSuccess(execution.id, changeRequest, target.env, actor.userId);
    }

    return this.auditApplyOutcome(actor, changeRequestId, execution.id);
  }

  /**
   * Reads the just-finalized Execution status and records a CR_APPLIED audit
   * entry (outcome mirrors execution.status), then returns the detail — the
   * single point both the backup-failure early-out and the run/finalize path
   * converge on, so every finalized apply attempt is audited exactly once.
   * Never logs SQL content or credentials.
   */
  private async auditApplyOutcome(actor: ApplyActor, changeRequestId: string, executionId: string) {
    const finalExec = await this.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      select: { status: true, targetDatabaseId: true },
    });
    await this.audit.record({
      actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
      action: AuditAction.CR_APPLIED,
      targetType: AuditTargetType.EXECUTION,
      targetId: executionId,
      outcome: finalExec.status === 'SUCCESS' ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
      summary: `적용 ${finalExec.status} (CR ${changeRequestId})`,
      metadata: {
        changeRequestId,
        targetDatabaseId: finalExec.targetDatabaseId,
        executionStatus: finalExec.status,
      },
    });
    return this.getExecutionDetail(executionId);
  }

  /**
   * Statically lints every file of a change request, applying the environment
   * policy (DEV downgrades BLOCK→WARN). See contract §3.
   */
  async lint(
    changeRequestId: string,
  ): Promise<LintResult & { changeRequestId: string; targetEnv: TargetEnv }> {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id: changeRequestId },
      include: { files: { orderBy: { order: 'asc' } } },
    });
    if (!changeRequest) {
      throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    }
    const policy = await this.sqlReview.getPolicyMap(changeRequest.targetEnv);
    const result = lintFiles(changeRequest.files, policy);
    return { changeRequestId: changeRequest.id, targetEnv: changeRequest.targetEnv, ...result };
  }

  /** Apply history for a change request (read-only, any authenticated role). */
  async listExecutions(changeRequestId: string) {
    const exists = await this.prisma.changeRequest.findUnique({
      where: { id: changeRequestId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    }
    return this.prisma.execution.findMany({
      where: { changeRequestId },
      orderBy: { createdAt: 'desc' },
      include: EXECUTION_INCLUDE,
    });
  }

  // --- guards --------------------------------------------------------------

  /** DEV: any non-rejected/non-applied status. STAGING|PROD: FINAL_APPROVED only. */
  private assertApprovalGate(env: TargetEnv, status: ChangeRequestStatus): void {
    if (env === TargetEnv.DEV) {
      if (DEV_BLOCKED_STATUSES.includes(status)) {
        throw new ConflictException(
          `거부/적용완료 상태(${status})의 변경요청은 적용할 수 없습니다.`,
        );
      }
      return;
    }
    if (status !== ChangeRequestStatus.FINAL_APPROVED) {
      throw new ConflictException(
        `STAGING/PROD 적용은 FINAL_APPROVED 상태에서만 가능합니다. (현재: ${status})`,
      );
    }
  }

  // --- execution lifecycle -------------------------------------------------

  /**
   * Serializes concurrent applies for the same CR: locks the CR row
   * (`FOR UPDATE`), rejects if a RUNNING execution already exists, then creates
   * a fresh RUNNING execution — all in one transaction.
   */
  private startExecution(changeRequestId: string, targetDatabaseId: string, triggeredById: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ChangeRequest WHERE id = ${changeRequestId} FOR UPDATE`;
      const running = await tx.execution.count({
        where: { changeRequestId, status: ExecutionStatus.RUNNING },
      });
      if (running > 0) {
        throw new ConflictException('이미 진행 중인 적용이 있습니다. 완료 후 다시 시도하세요.');
      }
      return tx.execution.create({
        data: {
          changeRequestId,
          targetDatabaseId,
          triggeredById,
          status: ExecutionStatus.RUNNING,
          startedAt: new Date(),
        },
      });
    });
  }

  /**
   * Runs each file in order, recording an ExecutionStep per file. Stops at the
   * first failure (files after it are not run, per contract §4.2 step 8).
   * Returns true if any step failed.
   */
  private async runFiles(
    executionId: string,
    target: TargetDatabase,
    files: FileToRun[],
  ): Promise<boolean> {
    const password = decryptSecret(target.passwordEnc);
    let connection;
    try {
      connection = await openTargetConnection(
        {
          host: target.host,
          port: target.port,
          username: target.username,
          password,
          database: target.database,
        },
        { multipleStatements: true },
      );
    } catch (err) {
      // Connection itself failed — record a synthetic failing step.
      await this.prisma.executionStep.create({
        data: {
          executionId,
          filename: '(connection)',
          order: 0,
          status: ExecutionStatus.FAILED,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return true;
    }

    try {
      for (const file of files) {
        try {
          const { rowsAffected, durationMs } = await runSqlFile(connection, file.content);
          await this.prisma.executionStep.create({
            data: {
              executionId,
              filename: file.filename,
              order: file.order,
              status: ExecutionStatus.SUCCESS,
              rowsAffected,
              durationMs,
            },
          });
        } catch (err) {
          await this.prisma.executionStep.create({
            data: {
              executionId,
              filename: file.filename,
              order: file.order,
              status: ExecutionStatus.FAILED,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          return true; // stop on first failure
        }
      }
      return false;
    } finally {
      await connection.end().catch(() => undefined);
    }
  }

  /**
   * Marks the execution SUCCESS. For STAGING|PROD also transitions the CR
   * FINAL_APPROVED → APPLIED and appends StatusHistory; DEV leaves the status
   * unchanged so it can be re-applied.
   */
  private async finalizeSuccess(
    executionId: string,
    changeRequest: { id: string; status: ChangeRequestStatus },
    env: TargetEnv,
    actorId: string,
  ): Promise<void> {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.execution.update({
        where: { id: executionId },
        data: { status: ExecutionStatus.SUCCESS, finishedAt: new Date() },
      }),
    ];

    if (env !== TargetEnv.DEV) {
      const toStatus = getNextStatus(changeRequest.status, 'APPLY');
      ops.push(
        this.prisma.changeRequest.update({
          where: { id: changeRequest.id },
          data: { status: toStatus },
        }),
        this.prisma.statusHistory.create({
          data: {
            changeRequestId: changeRequest.id,
            fromStatus: changeRequest.status,
            toStatus,
            actorId,
            comment: '적용 완료',
          },
        }),
      );
    }

    await this.prisma.$transaction(ops);
  }

  private getExecutionDetail(id: string) {
    return this.prisma.execution.findUniqueOrThrow({
      where: { id },
      include: EXECUTION_INCLUDE,
    });
  }
}
