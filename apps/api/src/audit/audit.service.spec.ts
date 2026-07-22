import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('buildData maps actor snapshot and defaults outcome to SUCCESS', () => {
    const svc = new AuditService({} as any);
    const data = svc.buildData({
      actor: { userId: 'u1', name: '개발자', role: 'DEVELOPER', department: '개발팀' },
      action: 'CR_APPROVED' as any, targetType: 'CHANGE_REQUEST' as any,
      targetId: 'c1', summary: '승인',
    });
    expect(data).toMatchObject({
      actorId: 'u1', actorName: '개발자', actorRole: 'DEVELOPER', actorDept: '개발팀',
      action: 'CR_APPROVED', targetType: 'CHANGE_REQUEST', targetId: 'c1',
      summary: '승인', outcome: 'SUCCESS',
    });
  });

  it('record swallows persistence errors (audit must never break the caller)', async () => {
    const prisma: any = { auditLog: { create: () => Promise.reject(new Error('db down')) } };
    const svc = new AuditService(prisma);
    await expect(svc.record({ action: 'LOGIN_SUCCESS' as any, targetType: 'AUTH' as any, summary: 'x' }))
      .resolves.toBeUndefined();
  });

  it('record persists via buildData', async () => {
    let captured: any = null;
    const prisma: any = { auditLog: { create: (a: any) => { captured = a; return Promise.resolve({}); } } };
    const svc = new AuditService(prisma);
    await svc.record({ action: 'USER_CREATED' as any, targetType: 'USER' as any, targetId: 'u9', summary: '생성' });
    expect(captured.data).toMatchObject({ action: 'USER_CREATED', targetId: 'u9', outcome: 'SUCCESS' });
  });

  it('list builds where filters and paginates (pageSize 50)', async () => {
    let args: any = null;
    const prisma: any = {
      auditLog: {
        findMany: (a: any) => { args = a; return Promise.resolve([{ id: '1' }]); },
        count: () => Promise.resolve(1),
      },
    };
    const svc = new AuditService(prisma);
    const res = await svc.list({ action: 'CR_APPROVED' as any, from: '2026-01-01', page: 2 });
    expect(args.where).toMatchObject({ action: 'CR_APPROVED', createdAt: { gte: new Date('2026-01-01') } });
    expect(args.skip).toBe(50); expect(args.take).toBe(50);
    expect(res).toMatchObject({ total: 1, page: 2, pageSize: 50 });
  });

  it('toCsv escapes commas/quotes and serializes metadata', () => {
    const svc = new AuditService({} as any);
    const csv = svc.toCsv([{ id:'1', createdAt: new Date('2026-01-01T00:00:00Z'), actorName:'A,B', action:'CR_APPROVED', targetType:'CHANGE_REQUEST', targetId:'c1', summary:'x"y', outcome:'SUCCESS', metadata:{ k:1 }, actorId:'u1', actorRole:'APPROVER', actorDept:'인프라팀', ip:null, userAgent:null } as any]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('createdAt,actorName,action');
    expect(row).toContain('"A,B"');       // 콤마 → 따옴표 감쌈
    expect(row).toContain('"x""y"');      // 따옴표 이스케이프
    expect(row).toContain('{""k"":1}');   // metadata JSON 직렬화 후 CSV 이스케이프
  });

  it('toCsv prefixes formula-injection-prone values with a single quote', () => {
    const svc = new AuditService({} as any);
    const csv = svc.toCsv([{ id:'1', createdAt: new Date('2026-01-01T00:00:00Z'), actorName:'=cmd()', action:'CR_APPROVED', targetType:'CHANGE_REQUEST', targetId:'c1', summary:'+SUM(1,2)', outcome:'SUCCESS', metadata:null, actorId:'u1', actorRole:'APPROVER', actorDept:'인프라팀', ip:null, userAgent:null } as any]);
    const [, row] = csv.trim().split('\n');
    expect(row).toContain("'=cmd()");
    expect(row).toContain('"\'+SUM(1,2)"'); // 콤마 포함 → 따옴표로 감싸지되 접두 따옴표는 유지
  });

  it('exportRows uses buildWhere (same as list) with no pagination and take 10000', async () => {
    let args: any = null;
    const prisma: any = {
      auditLog: { findMany: (a: any) => { args = a; return Promise.resolve([{ id: '1' }]); } },
    };
    const svc = new AuditService(prisma);
    await svc.exportRows({ action: 'CR_APPROVED' as any, from: '2026-01-01' });
    expect(args.where).toMatchObject({ action: 'CR_APPROVED', createdAt: { gte: new Date('2026-01-01') } });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBe(10000);
    expect(args.skip).toBeUndefined();
  });
});
