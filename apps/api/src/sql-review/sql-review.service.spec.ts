import { SqlReviewService } from './sql-review.service';

describe('SqlReviewService.getPolicyMap', () => {
  it('returns a complete 7-key map, filling DB gaps with effectiveSeverity', async () => {
    const prisma: any = { sqlReviewRule: { findMany: () => Promise.resolve([{ ruleKey: 'DROP_TABLE', level: 'BLOCK' }]) } };
    const svc = new SqlReviewService(prisma, { record: () => Promise.resolve() } as any);
    const map = await svc.getPolicyMap('DEV' as any);
    expect(map.size).toBe(7);
    expect(map.get('DROP_TABLE')).toBe('BLOCK');       // DB row
    expect(map.get('TRUNCATE')).toBe('WARN');           // gap → effectiveSeverity(BLOCK, DEV)=WARN
    expect(map.get('DROP_INDEX')).toBe('INFO');         // gap → base INFO
  });

  it('fails closed to base map when the DB query throws', async () => {
    const prisma: any = { sqlReviewRule: { findMany: () => Promise.reject(new Error('db down')) } };
    const svc = new SqlReviewService(prisma, { record: () => Promise.resolve() } as any);
    const map = await svc.getPolicyMap('PROD' as any);
    expect(map.size).toBe(7);
    expect(map.get('DROP_TABLE')).toBe('BLOCK');         // PROD base
  });
});

describe('SqlReviewService.update', () => {
  it('upserts the level and records an audit event', async () => {
    let upserted: any = null; const records: any[] = [];
    const prisma: any = {
      sqlReviewRule: {
        findUnique: () => Promise.resolve({ level: 'WARN' }),
        upsert: (a: any) => { upserted = a; return Promise.resolve({}); },
      },
    };
    const svc = new SqlReviewService(prisma, { record: (i: any) => { records.push(i); return Promise.resolve(); } } as any);
    await svc.update('DEV' as any, 'TRUNCATE', 'BLOCK' as any, { userId: 'a', name: '관리자', role: 'ADMIN', department: '운영팀' });
    expect(upserted.create).toMatchObject({ env: 'DEV', ruleKey: 'TRUNCATE', level: 'BLOCK' });
    expect(records[0]).toMatchObject({ action: 'SQL_POLICY_UPDATED', targetType: 'SQL_REVIEW_POLICY' });
    expect(records[0].metadata).toMatchObject({ env: 'DEV', ruleKey: 'TRUNCATE', from: 'WARN', to: 'BLOCK' });
  });

  it('rejects an unknown ruleKey', async () => {
    const svc = new SqlReviewService({} as any, { record: () => Promise.resolve() } as any);
    await expect(svc.update('DEV' as any, 'NOPE', 'BLOCK' as any, {} as any)).rejects.toBeTruthy();
  });
});
