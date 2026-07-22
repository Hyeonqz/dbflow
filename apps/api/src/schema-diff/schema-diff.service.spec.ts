import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SchemaDiffService } from './schema-diff.service';
import { parseDesiredSchema } from './desired-schema-parser';
import { introspectSchema } from './schema-introspector';
import { openTargetConnection } from '../target-database/target-connection';

jest.mock('./schema-introspector');
jest.mock('../target-database/target-connection');
jest.mock('../crypto/encryption.util', () => ({
  decryptSecret: jest.fn().mockReturnValue('pw'),
  encryptSecret: jest.fn(),
}));

const introspectMock = introspectSchema as jest.Mock;
const openConn = openTargetConnection as jest.Mock;

const DEV = { userId: 'dev', role: 'DEVELOPER' as const, name: 'Developer', department: 'Engineering' };
const USERS_SQL =
  'CREATE TABLE users (id INT NOT NULL AUTO_INCREMENT, email VARCHAR(255) NOT NULL, PRIMARY KEY (id));';

function makeService(opts: { env?: string; dbType?: string; current?: any } = {}) {
  const target = {
    id: 'db1',
    env: opts.env ?? 'DEV',
    dbType: opts.dbType ?? 'MYSQL',
    host: 'h',
    port: 3306,
    username: 'u',
    passwordEnc: 'enc',
    database: 'svc',
  };
  const targets = { getEntityForActor: jest.fn().mockResolvedValue(target) };
  const changeRequests = {
    create: jest.fn().mockResolvedValue({ id: 'cr1', status: 'DRAFT' }),
  };
  introspectMock.mockResolvedValue(opts.current ?? new Map());
  const service = new SchemaDiffService(targets as any, changeRequests as any);
  return { service, targets, changeRequests, target };
}

beforeEach(() => {
  jest.clearAllMocks();
  openConn.mockResolvedValue({ end: jest.fn().mockResolvedValue(undefined) });
  introspectMock.mockResolvedValue(new Map());
});

describe('SchemaDiffService.preview', () => {
  it('returns the snapshot summary and diff with hasChanges', async () => {
    const { service } = makeService({ current: new Map() });
    const result = await service.preview(DEV, {
      targetDatabaseId: 'db1',
      desiredSchemaSql: USERS_SQL,
    });

    expect(result.targetDatabaseId).toBe('db1');
    expect(result.currentSnapshotSummary.database).toBe('svc');
    expect(result.hasChanges).toBe(true);
    expect(result.diff[0]).toMatchObject({ kind: 'CREATE_TABLE', table: 'users' });
  });

  it('reports hasChanges=false for an in-sync schema', async () => {
    const { service } = makeService({ current: parseDesiredSchema(USERS_SQL) });
    const result = await service.preview(DEV, {
      targetDatabaseId: 'db1',
      desiredSchemaSql: USERS_SQL,
    });
    expect(result.hasChanges).toBe(false);
    expect(result.diff).toEqual([]);
  });

  it('propagates 404 from the visibility-scoped target lookup', async () => {
    const { service, targets } = makeService();
    targets.getEntityForActor.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.preview(DEV, { targetDatabaseId: 'db1', desiredSchemaSql: USERS_SQL }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a non-MYSQL target (409)', async () => {
    const { service } = makeService({ dbType: 'POSTGRES' });
    await expect(
      service.preview(DEV, { targetDatabaseId: 'db1', desiredSchemaSql: USERS_SQL }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects desired SQL with no CREATE TABLE (400)', async () => {
    const { service } = makeService();
    await expect(
      service.preview(DEV, { targetDatabaseId: 'db1', desiredSchemaSql: 'SELECT 1;' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SchemaDiffService.applyToChangeRequest', () => {
  it('bundles the diff into a DRAFT CR via ChangeRequestService.create', async () => {
    const { service, changeRequests } = makeService({ env: 'DEV', current: new Map() });

    await service.applyToChangeRequest(DEV, {
      targetDatabaseId: 'db1',
      desiredSchemaSql: USERS_SQL,
      title: 'users 정합화',
      description: '자동 diff',
    });

    expect(changeRequests.create).toHaveBeenCalledWith(
      DEV,
      expect.objectContaining({
        title: 'users 정합화',
        targetEnv: 'DEV',
        files: [
          expect.objectContaining({ filename: '001_create_table.sql', sqlType: 'DDL' }),
        ],
      }),
    );
  });

  it('numbers files in order for a multi-statement diff', async () => {
    // current users matches desired except the email column is missing; desired
    // also introduces a brand-new `logs` table -> ADD_COLUMN then CREATE_TABLE.
    const current = parseDesiredSchema(
      'CREATE TABLE users (id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY (id));',
    );
    const { service, changeRequests } = makeService({ current });

    await service.applyToChangeRequest(DEV, {
      targetDatabaseId: 'db1',
      desiredSchemaSql: `${USERS_SQL} CREATE TABLE logs (id INT);`,
      title: 't',
      description: 'd',
    });

    const files = changeRequests.create.mock.calls[0][1].files;
    expect(files.map((f: any) => f.filename)).toEqual([
      '001_add_column.sql',
      '002_create_table.sql',
    ]);
  });

  it('rejects with 409 when there is no diff', async () => {
    const { service, changeRequests } = makeService({ current: parseDesiredSchema(USERS_SQL) });
    await expect(
      service.applyToChangeRequest(DEV, {
        targetDatabaseId: 'db1',
        desiredSchemaSql: USERS_SQL,
        title: 't',
        description: 'd',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(changeRequests.create).not.toHaveBeenCalled();
  });
});
