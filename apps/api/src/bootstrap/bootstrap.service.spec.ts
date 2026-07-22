import { BootstrapService } from './bootstrap.service';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

function mockPrisma(userCount: number) {
  return {
    user: {
      count: jest.fn().mockResolvedValue(userCount),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sqlReviewRule: { upsert: jest.fn().mockResolvedValue({}) },
    approvalPolicy: { upsert: jest.fn().mockResolvedValue({}) },
  };
}

describe('BootstrapService', () => {
  const ENV_KEYS = ['DBFLOW_ADMIN_EMAIL', 'DBFLOW_ADMIN_PASSWORD', 'DBFLOW_DEMO'];
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });
  afterEach(() => exitSpy.mockRestore());

  it('사용자 0명 + env 없음 + 데모 아님 → 부팅 거부(exit 1)', async () => {
    const prisma = mockPrisma(0);
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('admin env 설정 시 없는 계정이면 ADMIN 생성, 이후 사용자 존재로 통과', async () => {
    process.env.DBFLOW_ADMIN_EMAIL = 'root@corp.io';
    process.env.DBFLOW_ADMIN_PASSWORD = 'secret-password';
    const prisma = mockPrisma(1); // 생성 후 count 시점엔 1명
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'root@corp.io', role: 'ADMIN', passwordHash: 'hashed' }),
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('기존 계정이 있으면 덮어쓰지 않는다', async () => {
    process.env.DBFLOW_ADMIN_EMAIL = 'root@corp.io';
    process.env.DBFLOW_ADMIN_PASSWORD = 'secret-password';
    const prisma = mockPrisma(1);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('DBFLOW_DEMO=true → 데모 계정 4개 + 규칙 21개 + 정책 3개 upsert', async () => {
    process.env.DBFLOW_DEMO = 'true';
    const prisma = mockPrisma(4);
    await new BootstrapService(prisma as any).onApplicationBootstrap();
    expect(prisma.user.upsert).toHaveBeenCalledTimes(4);
    expect(prisma.sqlReviewRule.upsert).toHaveBeenCalledTimes(21);
    expect(prisma.approvalPolicy.upsert).toHaveBeenCalledTimes(3);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
