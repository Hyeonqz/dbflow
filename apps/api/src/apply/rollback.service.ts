import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditOutcome,
  AuditTargetType,
  ExecutionKind,
  ExecutionStatus,
  Prisma,
  TargetDatabase,
} from '@prisma/client';
import { Connection } from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../crypto/encryption.util';
import { openTargetConnection } from '../target-database/target-connection';
import { assertApplyPermission, SafetyActor } from './apply-policy';
import { BackupService, TableSnapshot } from './backup.service';
import { AuditService } from '../audit/audit.service';

const EXECUTION_INCLUDE = {
  steps: { orderBy: { order: 'asc' } },
} satisfies Prisma.ExecutionInclude;

@Injectable()
export class RollbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Restores the tables captured by an apply's backup (contract §6):
   *  - existedBefore=false  → DROP TABLE (undo creation)
   *  - data snapshot        → DELETE + re-insert snapshot rows (transactional)
   *  - schema-only/over-cap → not restorable (recorded as a FAILED step)
   * Tracked as a new ROLLBACK Execution. DDL structural changes are NOT reverted.
   */
  async rollback(actor: SafetyActor, executionId: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { changeRequest: true, targetDatabase: true },
    });
    if (!execution) {
      throw new NotFoundException('실행 이력을 찾을 수 없습니다.');
    }
    if (execution.kind !== ExecutionKind.APPLY) {
      throw new ConflictException('롤백 대상은 적용(APPLY) 실행이어야 합니다.');
    }

    assertApplyPermission(actor, execution.targetDatabase.env, execution.changeRequest.authorId);

    if (!execution.backupId) {
      throw new ConflictException('연결된 백업이 없어 롤백할 수 없습니다.');
    }

    const payload = await this.backups.loadPayload(execution.backupId);

    const rollback = await this.prisma.execution.create({
      data: {
        changeRequestId: execution.changeRequestId,
        targetDatabaseId: execution.targetDatabaseId,
        triggeredById: actor.userId,
        backupId: execution.backupId,
        kind: ExecutionKind.ROLLBACK,
        status: ExecutionStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const hadHardFailure = await this.restoreTables(rollback.id, execution.targetDatabase, payload.tables);

    await this.prisma.execution.update({
      where: { id: rollback.id },
      data: {
        status: hadHardFailure ? ExecutionStatus.FAILED : ExecutionStatus.SUCCESS,
        finishedAt: new Date(),
      },
    });

    await this.audit.record({
      actor: { userId: actor.userId, name: actor.name, role: actor.role, department: actor.department },
      action: AuditAction.CR_ROLLED_BACK,
      targetType: AuditTargetType.EXECUTION,
      targetId: rollback.id,
      outcome: hadHardFailure ? AuditOutcome.FAILURE : AuditOutcome.SUCCESS,
      summary: `롤백 (원본 실행 ${executionId})`,
      metadata: { sourceExecutionId: executionId, rollbackExecutionId: rollback.id },
    });

    return this.prisma.execution.findUniqueOrThrow({
      where: { id: rollback.id },
      include: EXECUTION_INCLUDE,
    });
  }

  /** Returns true if a restorable table failed unexpectedly (hard failure). */
  private async restoreTables(
    executionId: string,
    target: TargetDatabase,
    tables: TableSnapshot[],
  ): Promise<boolean> {
    const connection = await this.connect(target);
    let hadHardFailure = false;
    try {
      let order = 0;
      for (const table of tables) {
        const result = await this.restoreTable(connection, table);
        await this.prisma.executionStep.create({
          data: {
            executionId,
            filename: table.name,
            order: order++,
            status: result.ok ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED,
            rowsAffected: result.rowsAffected ?? null,
            error: result.error ?? null,
          },
        });
        if (!result.ok && result.hard) hadHardFailure = true;
      }
    } finally {
      await connection.end().catch(() => undefined);
    }
    return hadHardFailure;
  }

  private async restoreTable(
    connection: Connection,
    table: TableSnapshot,
  ): Promise<{ ok: boolean; rowsAffected?: number; error?: string; hard?: boolean }> {
    // The apply created this table — undo by dropping it.
    if (!table.existedBefore) {
      try {
        await connection.query('DROP TABLE IF EXISTS ??', [table.name]);
        return { ok: true };
      } catch (err) {
        return { ok: false, hard: true, error: message(err) };
      }
    }

    // Schema-only / over-threshold: data was never captured.
    if (!table.dataIncluded) {
      return { ok: false, error: 'schema-only 백업 — 데이터 복구 불가(임계 초과 또는 미캡처).' };
    }

    // Restore data: wipe and re-insert the snapshot rows in one transaction.
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM ??', [table.name]);
      if (table.rows && table.rows.length > 0 && table.columns) {
        await connection.query('INSERT INTO ?? (??) VALUES ?', [
          table.name,
          table.columns,
          table.rows,
        ]);
      }
      await connection.commit();
      return { ok: true, rowsAffected: table.rows?.length ?? 0 };
    } catch (err) {
      await connection.rollback().catch(() => undefined);
      return { ok: false, hard: true, error: message(err) };
    }
  }

  private connect(target: TargetDatabase): Promise<Connection> {
    return openTargetConnection({
      host: target.host,
      port: target.port,
      username: target.username,
      password: decryptSecret(target.passwordEnc),
      database: target.database,
    });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
