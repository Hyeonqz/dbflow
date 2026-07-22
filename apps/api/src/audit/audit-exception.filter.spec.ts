import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuditExceptionFilter } from './audit-exception.filter';

function fakeHttpAdapter() {
  return {
    isHeadersSent: () => false,
    reply: (..._args: any[]) => undefined,
    end: (..._args: any[]) => undefined,
  };
}

function ctx(req: any, res: any = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getArgByIndex: (i: number) => (i === 1 ? res : req),
  } as any;
}

describe('AuditExceptionFilter', () => {
  it('records LOGIN_FAILURE for UnauthorizedException on /auth/login and delegates to base filter (no throw)', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const httpAdapter = fakeHttpAdapter();
    const replySpy = jest.spyOn(httpAdapter, 'reply');
    const filter = new AuditExceptionFilter(audit, httpAdapter as any);

    expect(() =>
      filter.catch(new UnauthorizedException('bad'), ctx({ method: 'POST', url: '/auth/login', body: { email: 'a@b.c' }, ip: '1.2.3.4', headers: {} })),
    ).not.toThrow();

    expect(records[0]).toMatchObject({ action: 'LOGIN_FAILURE', targetType: 'AUTH', outcome: 'FAILURE' });
    expect(records[0].metadata.email).toBe('a@b.c');
    expect(replySpy).toHaveBeenCalled();
  });

  it('records ACCESS_DENIED for ForbiddenException with actor from request.user and delegates to base filter (no throw)', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const httpAdapter = fakeHttpAdapter();
    const replySpy = jest.spyOn(httpAdapter, 'reply');
    const filter = new AuditExceptionFilter(audit, httpAdapter as any);
    const user = { userId: 'u1', role: 'DEVELOPER', name: 'D', department: '개발팀' };

    expect(() =>
      filter.catch(new ForbiddenException('no'), ctx({ method: 'POST', url: '/change-requests/c1/approve', user, ip: '1.1.1.1', headers: {} })),
    ).not.toThrow();

    expect(records[0]).toMatchObject({ action: 'ACCESS_DENIED', outcome: 'FAILURE', actor: { userId: 'u1' } });
    expect(replySpy).toHaveBeenCalled();
  });

  it('does not record for other exceptions but still delegates to produce a response (no throw)', () => {
    const records: any[] = [];
    const audit: any = { record: (i: any) => { records.push(i); return Promise.resolve(); } };
    const httpAdapter = fakeHttpAdapter();
    const replySpy = jest.spyOn(httpAdapter, 'reply');
    const filter = new AuditExceptionFilter(audit, httpAdapter as any);
    class Other extends Error {}

    expect(() =>
      filter.catch(new Other('x'), ctx({ method: 'GET', url: '/x', headers: {} })),
    ).not.toThrow();

    expect(records).toHaveLength(0);
    expect(replySpy).toHaveBeenCalled();
  });
});
