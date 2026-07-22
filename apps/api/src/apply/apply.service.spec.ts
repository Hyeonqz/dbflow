import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChangeRequestStatus, DbType, Role, TargetEnv } from '@prisma/client';
import { ApplyService } from './apply.service';
import { openTargetConnection } from '../target-database/target-connection';
import { runSqlFile } from './sql-runner';
import { RULE_CATALOG, effectiveSeverity } from './lint.engine';

const defaultPolicy = (env: any) =>
  new Map(RULE_CATALOG.map((r) => [r.ruleKey, effectiveSeverity(r.base, env)]));
const sqlReview = { getPolicyMap: (env: any) => Promise.resolve(defaultPolicy(env)) };

jest.mock('../target-database/target-connection');
jest.mock('./sql-runner');
jest.mock('../crypto/encryption.util', () => ({
  decryptSecret: jest.fn().mockReturnValue('decrypted-pw'),
  encryptSecret: jest.fn(),
}));

const S = ChangeRequestStatus;
const openConn = openTargetConnection as jest.Mock;
const runFile = runSqlFile as jest.Mock;

const APPROVER = { userId: 'boss', role: Role.APPROVER };
const DEV_AUTHOR = { userId: 'dev', role: Role.DEVELOPER };
const DEV_OTHER = { userId: 'other', role: Role.DEVELOPER };

function crOf(overrides: Partial<any> = {}) {
  return {
    id: 'cr1',
    targetEnv: TargetEnv.PROD,
    status: S.FINAL_APPROVED,
    authorId: 'dev',
    files: [{ filename: '001.sql', content: 'CREATE TABLE t (id INT);', order: 0 }],
    ...overrides,
  };
}

function targetOf(overrides: Partial<any> = {}) {
  return {
    id: 'db1',
    env: TargetEnv.PROD,
    dbType: DbType.MYSQL,
    host: 'h',
    port: 3306,
    username: 'u',
    passwordEnc: 'iv:tag:ct',
    database: 'd',
    ...overrides,
  };
}

function makeService(opts: { cr?: any; target?: any; running?: number } = {}) {
  const cr = opts.cr === undefined ? crOf() : opts.cr;
  const target = opts.target === undefined ? targetOf() : opts.target;

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    execution: {
      count: jest.fn().mockResolvedValue(opts.running ?? 0),
      create: jest.fn().mockResolvedValue({ id: 'ex1' }),
    },
  };

  const prisma: any = {
    changeRequest: {
      findUnique: jest.fn().mockResolvedValue(cr),
      update: jest.fn().mockResolvedValue({}),
    },
    targetDatabase: { findUnique: jest.fn().mockResolvedValue(target) },
    execution: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ex1', status: 'SUCCESS', steps: [] }),
    },
    executionStep: { create: jest.fn().mockResolvedValue({}) },
    statusHistory: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest
      .fn()
      .mockImplementation((arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
  };

  const backups = { createBackup: jest.fn().mockResolvedValue({ id: 'bk1' }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const schedule = { assertApplyAllowed: jest.fn().mockResolvedValue(undefined) };

  return {
    service: new ApplyService(prisma, backups as any, audit as any, sqlReview as any, schedule as any),
    prisma,
    tx,
    backups,
    audit,
    schedule,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  openConn.mockResolvedValue({ end: jest.fn().mockResolvedValue(undefined) });
  runFile.mockResolvedValue({ rowsAffected: 0, durationMs: 5 });
});

describe('ApplyService.apply', () => {
  describe('lookup + environment match', () => {
    it('404 when the change request is missing', async () => {
      const { service } = makeService({ cr: null });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 when the target database is missing', async () => {
      const { service } = makeService({ target: null });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409 when CR env and target env differ', async () => {
      const { service } = makeService({
        cr: crOf({ targetEnv: TargetEnv.STAGING }),
        target: targetOf({ env: TargetEnv.PROD }),
      });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('apply window / freeze gate (Plan 6)', () => {
    it('rejects apply outside the window (409) without creating an execution', async () => {
      const { service, tx, schedule } = makeService();
      schedule.assertApplyAllowed.mockRejectedValueOnce(
        new ConflictException('적용 작업창이 아닙니다. 다음 작업창: 화 02:00~04:00'),
      );
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(tx.execution.create).not.toHaveBeenCalled();
    });
  });

  describe('lint gate + auto-backup (Plan 5)', () => {
    it('rejects a PROD apply with a BLOCK lint and creates no execution/backup', async () => {
      const { service, tx, backups } = makeService({
        cr: crOf({ files: [{ filename: '001.sql', content: 'DROP TABLE users;', order: 0 }] }),
      });
      await expect(
        service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.execution.create).not.toHaveBeenCalled();
      expect(backups.createBackup).not.toHaveBeenCalled();
    });

    it('downgrades BLOCK to WARN on DEV and proceeds (no 409)', async () => {
      const { service, backups } = makeService({
        cr: crOf({
          targetEnv: TargetEnv.DEV,
          status: S.DRAFT,
          files: [{ filename: '001.sql', content: 'DROP TABLE users;', order: 0 }],
        }),
        target: targetOf({ env: TargetEnv.DEV }),
      });
      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
      expect(backups.createBackup).toHaveBeenCalled();
    });

    it('creates a backup and links it to the execution', async () => {
      const { service, backups, prisma } = makeService();
      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
      expect(backups.createBackup).toHaveBeenCalledWith(
        expect.objectContaining({ changeRequestId: 'cr1' }),
      );
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { backupId: 'bk1' } }),
      );
    });

    it('aborts the apply (FAILED) when backup creation fails', async () => {
      const { service, backups, prisma, tx } = makeService();
      backups.createBackup.mockRejectedValueOnce(new Error('disk full'));
      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
      expect(prisma.executionStep.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ filename: '(backup)' }) }),
      );
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      // files are never run after a failed backup
      expect(tx.execution.create).toHaveBeenCalled(); // execution slot was created
    });
  });

  describe('env-based RBAC', () => {
    it('DEV: author-developer may apply', async () => {
      const { service, prisma } = makeService({
        cr: crOf({ targetEnv: TargetEnv.DEV, status: S.DRAFT, authorId: 'dev' }),
        target: targetOf({ env: TargetEnv.DEV }),
      });
      await service.apply(DEV_AUTHOR, 'cr1', { targetDatabaseId: 'db1' });
      expect(prisma.execution.findUniqueOrThrow).toHaveBeenCalled();
    });

    it('DEV: non-author developer is forbidden', async () => {
      const { service } = makeService({
        cr: crOf({ targetEnv: TargetEnv.DEV, status: S.DRAFT, authorId: 'dev' }),
        target: targetOf({ env: TargetEnv.DEV }),
      });
      await expect(
        service.apply(DEV_OTHER, 'cr1', { targetDatabaseId: 'db1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('DEV: APPROVER may apply', async () => {
      const { service, prisma } = makeService({
        cr: crOf({ targetEnv: TargetEnv.DEV, status: S.DRAFT }),
        target: targetOf({ env: TargetEnv.DEV }),
      });
      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
      expect(prisma.execution.findUniqueOrThrow).toHaveBeenCalled();
    });

    it('PROD: a developer (even the author) is forbidden', async () => {
      const { service } = makeService();
      await expect(
        service.apply(DEV_AUTHOR, 'cr1', { targetDatabaseId: 'db1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('approval gate', () => {
    it('PROD: rejects when status is not FINAL_APPROVED (409)', async () => {
      const { service } = makeService({ cr: crOf({ status: S.REVIEW_APPROVED }) });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('DEV: rejects an already-APPLIED request (409)', async () => {
      const { service } = makeService({
        cr: crOf({ targetEnv: TargetEnv.DEV, status: S.APPLIED }),
        target: targetOf({ env: TargetEnv.DEV }),
      });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('concurrency guard', () => {
    it('409 when a RUNNING execution already exists for the CR', async () => {
      const { service } = makeService({ running: 1 });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('non-MYSQL targets', () => {
    it('409 for a non-MYSQL target', async () => {
      const { service } = makeService({ target: targetOf({ dbType: DbType.POSTGRES }) });
      await expect(service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('execution flow — PROD success', () => {
    it('records a SUCCESS step, marks execution SUCCESS, transitions CR to APPLIED', async () => {
      const { service, prisma, audit } = makeService();

      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

      expect(prisma.executionStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ filename: '001.sql', status: 'SUCCESS' }),
        }),
      );
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
      );
      expect(prisma.changeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: S.APPLIED } }),
      );
      expect(prisma.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ toStatus: S.APPLIED, actorId: 'boss' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CR_APPLIED',
          targetType: 'EXECUTION',
          targetId: 'ex1',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ changeRequestId: 'cr1', executionStatus: 'SUCCESS' }),
        }),
      );
    });
  });

  describe('execution flow — DEV success leaves status unchanged', () => {
    it('marks execution SUCCESS but does NOT transition or write history', async () => {
      const { service, prisma } = makeService({
        cr: crOf({ targetEnv: TargetEnv.DEV, status: S.DRAFT }),
        target: targetOf({ env: TargetEnv.DEV }),
      });

      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
      );
      expect(prisma.changeRequest.update).not.toHaveBeenCalled();
      expect(prisma.statusHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('execution flow — failure stops at the first failing file', () => {
    it('records FAILED step, skips later files, marks execution FAILED, no CR transition', async () => {
      const { service, prisma, audit } = makeService({
        cr: crOf({
          files: [
            { filename: '001_ok.sql', content: 'A', order: 0 },
            { filename: '002_bad.sql', content: 'B', order: 1 },
          ],
        }),
      });
      prisma.execution.findUniqueOrThrow.mockResolvedValue({
        id: 'ex1',
        status: 'FAILED',
        targetDatabaseId: 'db1',
        steps: [],
      });
      runFile
        .mockResolvedValueOnce({ rowsAffected: 1, durationMs: 10 })
        .mockRejectedValueOnce(new Error('You have an error in your SQL syntax'));

      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

      // only two files attempted (1 success + 1 failure); runner not called a 3rd time
      expect(runFile).toHaveBeenCalledTimes(2);
      const stepStatuses = prisma.executionStep.create.mock.calls.map(
        (c: any[]) => c[0].data.status,
      );
      expect(stepStatuses).toEqual(['SUCCESS', 'FAILED']);
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(prisma.changeRequest.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CR_APPLIED', outcome: 'FAILURE' }),
      );
    });
  });

  describe('connection failure', () => {
    it('records a synthetic failed step and marks the execution FAILED', async () => {
      const { service, prisma } = makeService();
      openConn.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await service.apply(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

      expect(prisma.executionStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ filename: '(connection)', status: 'FAILED' }),
        }),
      );
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });
  });
});

describe('ApplyService.listExecutions', () => {
  it('404 when the change request does not exist', async () => {
    const { service } = makeService({ cr: null });
    await expect(service.listExecutions('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns executions newest-first with steps', async () => {
    const { service, prisma } = makeService();
    await service.listExecutions('cr1');
    expect(prisma.execution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { changeRequestId: 'cr1' },
        orderBy: { createdAt: 'desc' },
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
  });
});
