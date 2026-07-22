import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TargetEnv } from '@prisma/client';
import { RollbackService } from './rollback.service';
import { openTargetConnection } from '../target-database/target-connection';

jest.mock('../target-database/target-connection');
jest.mock('../crypto/encryption.util', () => ({
  decryptSecret: jest.fn().mockReturnValue('pw'),
  encryptSecret: jest.fn(),
}));

const openConn = openTargetConnection as jest.Mock;

const APPROVER = { userId: 'boss', role: 'APPROVER' as const };
const DEV_OTHER = { userId: 'other', role: 'DEVELOPER' as const };

function makeConn() {
  return {
    query: jest.fn().mockResolvedValue([{}]),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(opts: {
  execution?: any;
  tables?: any[];
  env?: TargetEnv;
} = {}) {
  const env = opts.env ?? TargetEnv.DEV;
  const execution =
    opts.execution === undefined
      ? {
          id: 'ex1',
          kind: 'APPLY',
          backupId: 'bk1',
          changeRequestId: 'cr1',
          targetDatabaseId: 'db1',
          changeRequest: { authorId: 'dev' },
          targetDatabase: {
            id: 'db1',
            env,
            host: 'h',
            port: 3306,
            username: 'u',
            passwordEnc: 'enc',
            database: 'svc',
          },
        }
      : opts.execution;

  const updates: any[] = [];
  const steps: any[] = [];
  const prisma: any = {
    execution: {
      findUnique: jest.fn().mockResolvedValue(execution),
      create: jest.fn().mockResolvedValue({ id: 'rb1' }),
      update: jest.fn().mockImplementation((args: any) => {
        updates.push(args.data);
        return Promise.resolve({});
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'rb1', kind: 'ROLLBACK', steps: [] }),
    },
    executionStep: {
      create: jest.fn().mockImplementation((args: any) => {
        steps.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
  const backups = { loadPayload: jest.fn().mockResolvedValue({ tables: opts.tables ?? [] }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new RollbackService(prisma, backups as any, audit as any),
    prisma,
    backups,
    audit,
    updates,
    steps,
  };
}

let conn: ReturnType<typeof makeConn>;
beforeEach(() => {
  jest.clearAllMocks();
  conn = makeConn();
  openConn.mockResolvedValue(conn);
});

describe('RollbackService', () => {
  it('drops a table the apply newly created (existedBefore=false)', async () => {
    const { service, steps, updates, audit } = makeService({
      tables: [{ name: 'new_t', existedBefore: false }],
    });

    await service.rollback(APPROVER, 'ex1');

    expect(conn.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS ??', ['new_t']);
    expect(steps[0]).toMatchObject({ filename: 'new_t', status: 'SUCCESS' });
    expect(updates.at(-1)).toMatchObject({ status: 'SUCCESS' });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CR_ROLLED_BACK',
        targetType: 'EXECUTION',
        targetId: 'rb1',
        outcome: 'SUCCESS',
        metadata: expect.objectContaining({ sourceExecutionId: 'ex1', rollbackExecutionId: 'rb1' }),
      }),
    );
  });

  it('restores data via DELETE + re-insert for a data snapshot', async () => {
    const { service, steps } = makeService({
      tables: [
        {
          name: 'users',
          existedBefore: true,
          dataIncluded: true,
          columns: ['id', 'email'],
          rows: [
            [1, 'a@x'],
            [2, 'b@x'],
          ],
        },
      ],
    });

    await service.rollback(APPROVER, 'ex1');

    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.query).toHaveBeenCalledWith('DELETE FROM ??', ['users']);
    expect(conn.query).toHaveBeenCalledWith('INSERT INTO ?? (??) VALUES ?', [
      'users',
      ['id', 'email'],
      [
        [1, 'a@x'],
        [2, 'b@x'],
      ],
    ]);
    expect(conn.commit).toHaveBeenCalled();
    expect(steps[0]).toMatchObject({ filename: 'users', status: 'SUCCESS', rowsAffected: 2 });
  });

  it('marks schema-only tables non-restorable but keeps overall SUCCESS', async () => {
    const { service, steps, updates } = makeService({
      tables: [{ name: 'big_log', existedBefore: true, dataIncluded: false }],
    });

    await service.rollback(APPROVER, 'ex1');

    expect(steps[0]).toMatchObject({ filename: 'big_log', status: 'FAILED' });
    expect(steps[0].error).toMatch(/복구 불가/);
    expect(updates.at(-1)).toMatchObject({ status: 'SUCCESS' });
  });

  it('marks overall FAILED when a data restore throws', async () => {
    const { service, updates, audit } = makeService({
      tables: [{ name: 'users', existedBefore: true, dataIncluded: true, columns: ['id'], rows: [[1]] }],
    });
    conn.query.mockRejectedValueOnce(new Error('FK violation')); // DELETE fails

    await service.rollback(APPROVER, 'ex1');

    expect(conn.rollback).toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'FAILED' });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CR_ROLLED_BACK', outcome: 'FAILURE' }),
    );
  });

  it('404 when the execution is missing', async () => {
    const { service, prisma } = makeService();
    prisma.execution.findUnique.mockResolvedValueOnce(null);
    await expect(service.rollback(APPROVER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 when the execution is itself a ROLLBACK', async () => {
    const { service } = makeService({
      execution: {
        id: 'ex1',
        kind: 'ROLLBACK',
        backupId: 'bk1',
        changeRequest: { authorId: 'dev' },
        targetDatabase: { env: TargetEnv.DEV },
      },
    });
    await expect(service.rollback(APPROVER, 'ex1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 when there is no linked backup', async () => {
    const { service } = makeService({
      execution: {
        id: 'ex1',
        kind: 'APPLY',
        backupId: null,
        changeRequest: { authorId: 'dev' },
        targetDatabase: { env: TargetEnv.DEV },
      },
    });
    await expect(service.rollback(APPROVER, 'ex1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('forbids a non-author developer rolling back a PROD execution', async () => {
    const { service } = makeService({ env: TargetEnv.PROD });
    await expect(service.rollback(DEV_OTHER, 'ex1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
