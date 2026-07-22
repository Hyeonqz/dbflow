import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

const ctx = (role: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  getHandler: () => ({}),
  getClass: () => ({}),
}) as any;

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('DEVELOPER'))).toBe(true);
  });

  it('allows when user role is permitted', () => {
    const reflector = { getAllAndOverride: () => ['REVIEWER'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('REVIEWER'))).toBe(true);
  });

  it('denies when user role is not permitted', () => {
    const reflector = { getAllAndOverride: () => ['APPROVER'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctx('DEVELOPER'))).toBe(false);
  });
});
