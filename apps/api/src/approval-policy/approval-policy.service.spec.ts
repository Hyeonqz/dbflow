import { ApprovalPolicyService } from './approval-policy.service';

describe('ApprovalPolicyService', () => {
  it('getRequired returns policy value, defaults to 1 when missing/failing', async () => {
    const hit: any = { approvalPolicy: { findUnique: () => Promise.resolve({ requiredApprovals: 2 }) } };
    expect(await new ApprovalPolicyService(hit, {} as any).getRequired('PROD' as any)).toBe(2);
    const miss: any = { approvalPolicy: { findUnique: () => Promise.resolve(null) } };
    expect(await new ApprovalPolicyService(miss, {} as any).getRequired('DEV' as any)).toBe(1);
    const boom: any = { approvalPolicy: { findUnique: () => Promise.reject(new Error('x')) } };
    expect(await new ApprovalPolicyService(boom, {} as any).getRequired('DEV' as any)).toBe(1);
  });

  it('update upserts and audits from/to', async () => {
    let up: any = null; const rec: any[] = [];
    const prisma: any = { approvalPolicy: {
      findUnique: () => Promise.resolve({ requiredApprovals: 1 }),
      upsert: (a: any) => { up = a; return Promise.resolve({}); } } };
    const svc = new ApprovalPolicyService(prisma, { record: (i: any) => { rec.push(i); return Promise.resolve(); } } as any);
    await svc.update('PROD' as any, 2, { userId: 'a', name: 'A', role: 'ADMIN', department: '운영팀' });
    expect(up.create).toMatchObject({ env: 'PROD', requiredApprovals: 2 });
    expect(rec[0]).toMatchObject({ action: 'APPROVAL_POLICY_UPDATED', targetType: 'APPROVAL_POLICY' });
    expect(rec[0].metadata).toMatchObject({ env: 'PROD', from: 1, to: 2 });
  });
});
