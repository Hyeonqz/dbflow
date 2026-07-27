import { execFileSync } from 'child_process';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

const TUE = new Date(2026, 6, 21, 3, 0, 0); // 화 03:00 KST

function svc(overrides: any = {}) {
  const prisma: any = {
    delegation: {
      findMany: overrides.findMany ?? (() => Promise.resolve([])),
      findFirst: overrides.findFirst ?? (() => Promise.resolve(null)),
      findUnique: overrides.findUnique ?? (() => Promise.resolve(null)),
      create: overrides.create ?? ((a: any) => Promise.resolve({ id: 'd1', ...a.data })),
      delete: overrides.delete ?? (() => Promise.resolve({})),
    },
    user: { findMany: overrides.users ?? (() => Promise.resolve([])) },
  };
  const audit = { record: overrides.record ?? (() => Promise.resolve()) };
  return new DelegationService(prisma as any, audit as any);
}

describe('DelegationService.activeDelegatorIds', () => {
  it('returns delegatorIds for active windows only', async () => {
    const s = svc({ findMany: ({ where }: any) => {
      // 검증: where.delegateId, startsAt.lte, endsAt.gt 형태
      expect(where.delegateId).toBe('Y');
      return Promise.resolve([{ delegatorId: 'X1' }, { delegatorId: 'X2' }]);
    }});
    expect(await s.activeDelegatorIds('Y')).toEqual(['X1', 'X2']);
  });
});

describe('DelegationService.createDelegation', () => {
  const admin = { userId: 'adm', name: 'A', role: 'ADMIN', department: '운영팀' };
  const appr = { userId: 'X', name: 'X', role: 'APPROVER', department: 'infra' };

  it('rejects self-delegation', async () => {
    await expect(svc().createDelegation(
      { delegateId: 'X', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects role mismatch (delegate not same role)', async () => {
    const s = svc({ users: () => Promise.resolve([
      { id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'REVIEWER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any, appr as any,
    )).rejects.toMatchObject({ response: { key: 'delegation.sameRoleOnly' } });
  });

  it('rejects startsAt >= endsAt', async () => {
    const s = svc({ users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]) });
    await expect(s.createDelegation(
      { delegateId: 'Y', startsAt: '2026-07-02T00:00', endsAt: '2026-07-01T00:00' } as any, appr as any,
    )).rejects.toMatchObject({ response: { key: 'delegation.startBeforeEnd' } });
  });

  it('non-admin forces delegatorId to self and converts KST', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'SOMEONE_ELSE', delegateId: 'Y', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00' } as any,
      appr as any,
    );
    expect(created.delegatorId).toBe('X');          // self 강제(비-ADMIN)
    expect(created.startsAt.toISOString()).toBe('2026-09-29T15:00:00.000Z'); // KST 00:00
  });

  // 참고: jest 프로세스 안에서 process.env.TZ를 재대입해도 V8/ICU가 프로세스 시작 시
  // 캐시한 타임존을 재평가하지 않는 경우가 있어(이 러너에서 재현됨), 하드코딩 오프셋으로의
  // 회귀를 실제로 잡아내려면 TZ를 프로세스 기동 전에 고정한 자식 프로세스로 검증해야 한다.
  it('createDelegation parses wall-clock via process TZ (spawned with non-Seoul TZ), not a hardcoded +09:00 offset', () => {
    const script = `
      const { DelegationService } = require(${JSON.stringify(path.join(__dirname, 'delegation.service.ts'))});
      let created;
      const prisma = {
        delegation: {
          findFirst: () => Promise.resolve(null),
          create: (a) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
        },
        user: { findMany: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]) },
      };
      const audit = { record: () => Promise.resolve() };
      const s = new DelegationService(prisma, audit);
      s.createDelegation(
        { delegatorId: 'X', delegateId: 'Y', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00' },
        { userId: 'X', name: 'X', role: 'APPROVER', department: 'infra' },
      ).then(() => { process.stdout.write(created.startsAt.toISOString()); });
    `;
    const out = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', '-e', script],
      { env: { ...process.env, TZ: 'Europe/Berlin' }, encoding: 'utf-8' },
    ).trim();
    // Berlin은 CEST(+02:00) — Seoul(+09:00) 케이스와 다른 UTC 순간이어야 한다.
    expect(out).toBe('2026-09-29T22:00:00.000Z'); // Berlin 00:00 = UTC 전일 22:00
    expect(out).not.toBe('2026-09-29T15:00:00.000Z');
  }, 20000);

  it('admin may set delegatorId to another user', async () => {
    let created: any = null;
    const s = svc({
      users: () => Promise.resolve([{ id: 'X', role: 'APPROVER' }, { id: 'Y', role: 'APPROVER' }]),
      create: (a: any) => { created = a.data; return Promise.resolve({ id: 'd1', ...a.data }); },
    });
    await s.createDelegation(
      { delegatorId: 'X', delegateId: 'Y', startsAt: '2026-07-01T00:00', endsAt: '2026-07-02T00:00' } as any,
      admin as any,
    );
    expect(created.delegatorId).toBe('X');
    expect(created.createdById).toBe('adm');
  });
});

describe('DelegationService.deleteDelegation', () => {
  it('forbids a non-owner non-admin', async () => {
    const s = svc({ findUnique: () => Promise.resolve({ id: 'd1', delegatorId: 'X', delegateId: 'Y' }) });
    await expect(s.deleteDelegation('d1', { userId: 'Z', role: 'APPROVER' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
