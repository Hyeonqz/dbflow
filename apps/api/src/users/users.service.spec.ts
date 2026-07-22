import { UsersService } from './users.service';
import { verifyPassword } from '../auth/password.util';

const ACTOR = { userId: 'admin1', name: 'Admin', role: 'ADMIN', department: 'IT본부' };

function makeAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

describe('UsersService', () => {
  it('creates a user with a hashed password', async () => {
    const store: any[] = [];
    const prisma: any = {
      user: {
        create: ({ data }: any) => { store.push(data); return Promise.resolve({ id: '1', ...data }); },
        findUnique: ({ where }: any) =>
          Promise.resolve(store.find((u) => u.email === where.email) ?? null),
      },
    };
    const audit = makeAudit();
    const service = new UsersService(prisma, audit as any);
    const user = await service.create({
      email: 'dev@x.com', name: 'Dev', department: 'DBA팀', password: 'pw123456', role: 'DEVELOPER',
    }, ACTOR);
    expect(user.passwordHash).not.toEqual('pw123456');
    expect(await verifyPassword(user.passwordHash, 'pw123456')).toBe(true);
    expect(await service.findByEmail('dev@x.com')).not.toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'USER_CREATED',
        targetType: 'USER',
        targetId: '1',
        metadata: { role: 'DEVELOPER', department: 'DBA팀' },
      }),
    );
  });

  it('lists users by role with minimal fields', async () => {
    const prisma: any = {
      user: { findMany: ({ where, select }: any) => Promise.resolve([{ id: '1', name: 'A', department: 'DBA팀' }]) },
    };
    const service = new UsersService(prisma, makeAudit() as any);
    const rows = await service.listByRole('REVIEWER' as any);
    expect(rows[0]).toEqual({ id: '1', name: 'A', department: 'DBA팀' });
  });

  it('updates own profile fields', async () => {
    let updated: any = null;
    const prisma: any = {
      user: { update: ({ where, data }: any) => { updated = { where, data }; return Promise.resolve({ id: where.id, ...data }); } },
    };
    const audit = makeAudit();
    const service = new UsersService(prisma, audit as any);
    await service.updateMe('u1', { department: 'IT본부' }, ACTOR);
    expect(updated).toEqual({ where: { id: 'u1' }, data: { department: 'IT본부' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'USER_PROFILE_UPDATED',
        targetType: 'USER',
        targetId: 'u1',
        metadata: { fields: ['department'] },
      }),
    );
  });
});

function svc(overrides: any = {}) {
  const prisma: any = {
    user: {
      findMany: overrides.findMany ?? (() => Promise.resolve([])),
      count: overrides.count ?? (() => Promise.resolve(0)),
    },
  };
  return new UsersService(prisma, { record: () => Promise.resolve() } as any);
}

describe('UsersService.adminList', () => {
  it('applies role filter and name/email search to where, paginates', async () => {
    let args: any = null;
    const s = svc({
      findMany: (a: any) => { args = a; return Promise.resolve([{ id: 'u1' }]); },
      count: () => Promise.resolve(42),
    });
    const res = await s.adminList({ page: 2, role: 'DEVELOPER' as any, q: 'kim' });
    expect(args.where).toMatchObject({ role: 'DEVELOPER' });
    expect(args.where.OR).toEqual([{ name: { contains: 'kim' } }, { email: { contains: 'kim' } }]);
    expect(args.skip).toBe(20); // (page2-1)*20
    expect(args.take).toBe(20);
    expect(args.select.passwordHash).toBeUndefined(); // 노출 금지
    expect(res).toMatchObject({ total: 42, page: 2, pageSize: 20 });
  });

  it('defaults page to 1 and omits role/OR when not given', async () => {
    let args: any = null;
    const s = svc({ findMany: (a: any) => { args = a; return Promise.resolve([]); } });
    await s.adminList({});
    expect(args.skip).toBe(0);
    expect(args.where.role).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });
});
