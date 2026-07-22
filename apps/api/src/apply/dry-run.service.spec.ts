import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TargetEnv } from '@prisma/client';
import { DryRunService } from './dry-run.service';
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
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([{ affectedRows: 2 }]),
    rollback: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(files: { filename: string; content: string }[], opts: { env?: TargetEnv } = {}) {
  const env = opts.env ?? TargetEnv.DEV;
  const cr = {
    id: 'cr1',
    targetEnv: env,
    authorId: 'dev',
    files: files.map((f, i) => ({ ...f, order: i })),
  };
  const target = {
    id: 'db1',
    env,
    dbType: 'MYSQL',
    host: 'h',
    port: 3306,
    username: 'u',
    passwordEnc: 'enc',
    database: 'svc',
  };
  const prisma: any = {
    changeRequest: { findUnique: jest.fn().mockResolvedValue(cr) },
    targetDatabase: { findUnique: jest.fn().mockResolvedValue(target) },
  };
  return { service: new DryRunService(prisma), prisma };
}

let conn: ReturnType<typeof makeConn>;
beforeEach(() => {
  jest.clearAllMocks();
  conn = makeConn();
  openConn.mockResolvedValue(conn);
});

describe('DryRunService', () => {
  it('runs a pure-DML file in a transaction and always rolls back', async () => {
    const { service } = makeService([
      { filename: '001_update.sql', content: 'UPDATE users SET a=1 WHERE id=1;' },
    ]);

    const result = await service.dryRun(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

    expect(result.perFile[0]).toMatchObject({
      filename: '001_update.sql',
      mode: 'DML_TX_ROLLBACK',
      affectedRows: 2,
      destructive: false,
    });
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('classifies a DDL file statically without executing it', async () => {
    const { service } = makeService([
      { filename: '002_alter.sql', content: 'ALTER TABLE users ADD COLUMN x INT;' },
    ]);

    const result = await service.dryRun(APPROVER, 'cr1', { targetDatabaseId: 'db1' });

    expect(result.perFile[0]).toMatchObject({ mode: 'DDL_STATIC', destructive: false });
    expect(result.perFile[0].affectedRows).toBeUndefined();
    expect(conn.query).not.toHaveBeenCalled(); // never executed
  });

  it('flags destructive DDL (DROP TABLE)', async () => {
    const { service } = makeService([{ filename: '003_drop.sql', content: 'DROP TABLE users;' }]);
    const result = await service.dryRun(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
    expect(result.perFile[0]).toMatchObject({ mode: 'DDL_STATIC', destructive: true });
  });

  it('flags a WHERE-less DELETE as destructive even though rolled back', async () => {
    const { service } = makeService([{ filename: '004_del.sql', content: 'DELETE FROM users;' }]);
    const result = await service.dryRun(APPROVER, 'cr1', { targetDatabaseId: 'db1' });
    expect(result.perFile[0]).toMatchObject({ mode: 'DML_TX_ROLLBACK', destructive: true });
  });

  it('rejects env mismatch (409)', async () => {
    const { service } = makeService([{ filename: 'a.sql', content: 'UPDATE t SET a=1 WHERE id=1;' }], {
      env: TargetEnv.DEV,
    });
    // CR is DEV but target says PROD
    (service as any).prisma.targetDatabase.findUnique.mockResolvedValueOnce({
      id: 'db1',
      env: TargetEnv.PROD,
      dbType: 'MYSQL',
      host: 'h',
      port: 3306,
      username: 'u',
      passwordEnc: 'enc',
      database: 'svc',
    });
    await expect(
      service.dryRun(APPROVER, 'cr1', { targetDatabaseId: 'db1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('forbids a non-author developer on a non-DEV target', async () => {
    const { service } = makeService([{ filename: 'a.sql', content: 'UPDATE t SET a=1 WHERE id=1;' }], {
      env: TargetEnv.PROD,
    });
    await expect(
      service.dryRun(DEV_OTHER, 'cr1', { targetDatabaseId: 'db1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 when the change request is missing', async () => {
    const { service, prisma } = makeService([{ filename: 'a.sql', content: 'SELECT 1;' }]);
    prisma.changeRequest.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.dryRun(APPROVER, 'missing', { targetDatabaseId: 'db1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
