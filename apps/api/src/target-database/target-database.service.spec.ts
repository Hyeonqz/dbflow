import { NotFoundException } from '@nestjs/common';
import { DbType, Role, TargetEnv } from '@prisma/client';
import { TargetDatabaseService } from './target-database.service';

// 32-byte test key so the real encryption util runs end-to-end.
process.env.APP_ENCRYPTION_KEY = '0'.repeat(64);

const APPROVER = { userId: 'boss', role: Role.APPROVER };
const DEVELOPER = { userId: 'dev', role: Role.DEVELOPER };
const ACTOR = { userId: 'boss', name: 'Boss', role: Role.APPROVER, department: 'DBA팀' };

function makeAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'db1',
    name: '운영 MySQL',
    env: TargetEnv.PROD,
    dbType: DbType.MYSQL,
    host: 'db.prod',
    port: 3306,
    username: 'app',
    passwordEnc: 'iv:tag:ct',
    database: 'service',
    createdAt: new Date('2026-06-20T00:00:00Z'),
    updatedAt: new Date('2026-06-20T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    targetDatabase: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(makeRecord(data))),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(makeRecord(data))),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const audit = makeAudit();
  return { service: new TargetDatabaseService(prisma, audit as any), prisma, audit };
}

describe('TargetDatabaseService', () => {
  describe('create', () => {
    it('encrypts the password into passwordEnc and never returns it', async () => {
      const { service, prisma, audit } = makeService();

      const result: any = await service.create({
        name: 'x',
        env: TargetEnv.DEV,
        host: 'h',
        port: 3306,
        username: 'u',
        password: 'plaintext-secret',
        database: 'd',
      }, ACTOR);

      const passedData = prisma.targetDatabase.create.mock.calls[0][0].data;
      expect(passedData.passwordEnc).toBeDefined();
      expect(passedData.passwordEnc).not.toContain('plaintext-secret');
      expect(passedData).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordEnc');
      expect(result).not.toHaveProperty('password');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actor: ACTOR, action: 'TARGET_DB_CREATED', targetType: 'TARGET_DATABASE' }),
      );
      const auditedMetadata = audit.record.mock.calls[0][0].metadata;
      expect(JSON.stringify(auditedMetadata)).not.toContain('plaintext-secret');
    });

    it('defaults dbType to MYSQL when omitted', async () => {
      const { service, prisma } = makeService();
      await service.create({
        name: 'x',
        env: TargetEnv.DEV,
        host: 'h',
        port: 3306,
        username: 'u',
        password: 'p',
        database: 'd',
      }, ACTOR);
      expect(prisma.targetDatabase.create.mock.calls[0][0].data.dbType).toBe(DbType.MYSQL);
    });
  });

  describe('read visibility (RBAC)', () => {
    it('APPROVER lists all targets (no env filter)', async () => {
      const { service, prisma } = makeService();
      await service.list(APPROVER);
      expect(prisma.targetDatabase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('DEVELOPER lists only DEV targets', async () => {
      const { service, prisma } = makeService();
      await service.list(DEVELOPER);
      expect(prisma.targetDatabase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { env: TargetEnv.DEV } }),
      );
    });

    it('DEVELOPER detail scopes the query to DEV (non-DEV -> 404)', async () => {
      const { service, prisma } = makeService();
      await expect(service.findOne(DEVELOPER, 'db1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.targetDatabase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'db1', env: TargetEnv.DEV } }),
      );
    });

    it('APPROVER detail is unscoped and sanitized', async () => {
      const { service, prisma } = makeService();
      prisma.targetDatabase.findFirst.mockResolvedValueOnce(makeRecord());
      const result: any = await service.findOne(APPROVER, 'db1');
      expect(prisma.targetDatabase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'db1' } }),
      );
      expect(result).not.toHaveProperty('passwordEnc');
    });
  });

  describe('update', () => {
    it('re-encrypts when password supplied', async () => {
      const { service, prisma, audit } = makeService();
      prisma.targetDatabase.findUnique.mockResolvedValueOnce(makeRecord());
      await service.update('db1', { password: 'newpw' }, ACTOR);
      const data = prisma.targetDatabase.update.mock.calls[0][0].data;
      expect(data.passwordEnc).toBeDefined();
      expect(data.passwordEnc).not.toContain('newpw');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: ACTOR,
          action: 'TARGET_DB_UPDATED',
          targetType: 'TARGET_DATABASE',
          targetId: 'db1',
          metadata: { credentialChanged: true },
        }),
      );
    });

    it('leaves passwordEnc untouched when password omitted', async () => {
      const { service, prisma, audit } = makeService();
      prisma.targetDatabase.findUnique.mockResolvedValueOnce(makeRecord());
      await service.update('db1', { host: 'db2' }, ACTOR);
      const data = prisma.targetDatabase.update.mock.calls[0][0].data;
      expect(data.passwordEnc).toBeUndefined();
      expect(data.host).toBe('db2');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { credentialChanged: false } }),
      );
    });

    it('throws NotFound for a missing target', async () => {
      const { service } = makeService();
      await expect(service.update('missing', { host: 'x' }, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes and returns the marker', async () => {
      const { service, prisma, audit } = makeService();
      prisma.targetDatabase.findUnique.mockResolvedValueOnce(makeRecord());
      await expect(service.remove('db1', ACTOR)).resolves.toEqual({ id: 'db1', deleted: true });
      expect(prisma.targetDatabase.delete).toHaveBeenCalledWith({ where: { id: 'db1' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: ACTOR,
          action: 'TARGET_DB_DELETED',
          targetType: 'TARGET_DATABASE',
          targetId: 'db1',
        }),
      );
    });
  });

  describe('testConnection', () => {
    it('rejects non-MYSQL targets without attempting a connection', async () => {
      const { service, prisma } = makeService();
      prisma.targetDatabase.findUnique.mockResolvedValueOnce(
        makeRecord({ dbType: DbType.POSTGRES }),
      );
      await expect(service.testConnection('db1')).resolves.toEqual({
        success: false,
        error: expect.stringContaining('MYSQL'),
      });
    });
  });
});
