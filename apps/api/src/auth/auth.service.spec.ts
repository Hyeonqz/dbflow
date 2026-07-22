import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';

describe('AuthService', () => {
  const makeService = (storedHash: string) => {
    const users: any = {
      findByEmail: (email: string) =>
        Promise.resolve(
          email === 'dev@x.com'
            ? { id: '1', email, name: 'Dev', role: 'DEVELOPER', department: 'Engineering', passwordHash: storedHash }
            : null,
        ),
    };
    const jwt: any = { sign: (p: any) => `token:${p.sub}:${p.role}` };
    const audit: any = { record: () => Promise.resolve() };
    return new AuthService(users, jwt, audit);
  };

  it('returns token and sanitized user on valid credentials', async () => {
    const service = makeService(await hashPassword('pw123456'));
    const result = await service.validateAndLogin('dev@x.com', 'pw123456');
    expect(result.accessToken).toBe('token:1:DEVELOPER');
    expect(result.user).toEqual({ id: '1', email: 'dev@x.com', name: 'Dev', role: 'DEVELOPER', department: 'Engineering' });
    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('throws on wrong password', async () => {
    const service = makeService(await hashPassword('pw123456'));
    await expect(service.validateAndLogin('dev@x.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws on unknown user', async () => {
    const service = makeService(await hashPassword('pw123456'));
    await expect(service.validateAndLogin('nobody@x.com', 'pw123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
