import { ConflictException } from '@nestjs/common';
import { ApplyScheduleService } from './apply-schedule.service';

// 화요일 03:00 KST 고정 시각 (2026-07-21은 화요일)
const TUE_0300 = new Date(2026, 6, 21, 3, 0, 0);

function svc(windows: any[] = [], freezes: any[] = []) {
  const prisma: any = {
    applyWindow: { findMany: () => Promise.resolve(windows) },
    freezePeriod: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          freezes.find((f) => f.startsAt <= where.startsAt.lte && f.endsAt > where.startsAt.lte) ?? null,
        ),
    },
  };
  return new ApplyScheduleService(prisma, { record: () => Promise.resolve() } as any);
}

describe('ApplyScheduleService.checkApplyAllowed', () => {
  it('allows when no windows configured (무회귀)', async () => {
    expect((await svc().checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true);
  });

  it('allows inside a window, denies outside with nextWindow', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }]; // 화 02:00~04:00
    expect((await svc(win).checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true);
    const out = await svc(win).checkApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0));
    expect(out).toMatchObject({ allowed: false, reason: 'OUT_OF_WINDOW' });
    expect((out as any).nextWindow).toMatchObject({ dayOfWeek: 2, startMinute: 120 }); // 다음 주 화
  });

  it('boundary: startMinute==now allowed, endMinute==now denied', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 180, endMinute: 240, env: 'PROD' }];
    expect((await svc(win).checkApplyAllowed('PROD' as any, TUE_0300)).allowed).toBe(true); // 03:00 == start
    expect((await svc(win).checkApplyAllowed('PROD' as any, new Date(2026, 6, 21, 4, 0))).allowed).toBe(false); // 04:00 == end
  });

  it('freeze wins over an open window', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    const frz = [{ startsAt: new Date(2026, 6, 20), endsAt: new Date(2026, 6, 25), reason: '분기말', env: 'PROD' }];
    const r = await svc(win, frz).checkApplyAllowed('PROD' as any, TUE_0300);
    expect(r).toMatchObject({ allowed: false, reason: 'FROZEN' });
    expect((r as any).freeze.reason).toBe('분기말');
  });

  it('freeze boundary: startsAt==now frozen, endsAt==now allowed', async () => {
    const at = TUE_0300;
    const f1 = [{ startsAt: at, endsAt: new Date(2026, 6, 25), reason: 'x', env: 'PROD' }];
    expect((await svc([], f1).checkApplyAllowed('PROD' as any, at)).allowed).toBe(false);
    const f2 = [{ startsAt: new Date(2026, 6, 20), endsAt: at, reason: 'x', env: 'PROD' }];
    expect((await svc([], f2).checkApplyAllowed('PROD' as any, at)).allowed).toBe(true);
  });

  it('nextWindow wraps the week (일요일 밤 → 화요일 창)', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    const sunNight = new Date(2026, 6, 19, 23, 0); // 일요일
    const r = await svc(win).checkApplyAllowed('PROD' as any, sunNight);
    expect((r as any).nextWindow).toMatchObject({ dayOfWeek: 2, startMinute: 120, endMinute: 240 });
  });

  it('assertApplyAllowed throws 409 with i18n key', async () => {
    const win = [{ dayOfWeek: 2, startMinute: 120, endMinute: 240, env: 'PROD' }];
    await expect(
      svc(win).assertApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc(win).assertApplyAllowed('PROD' as any, new Date(2026, 6, 21, 5, 0)),
    ).rejects.toMatchObject({
      response: { key: 'applySchedule.outOfWindowNext', args: { day: '화', start: '02:00', end: '04:00' } },
    });
  });
});

describe('ApplyScheduleService CRUD', () => {
  it('createFreeze converts KST wall-clock to UTC instant (+09:00)', async () => {
    let created: any = null;
    const prisma: any = {
      freezePeriod: { create: (a: any) => { created = a.data; return Promise.resolve({ id: 'f1', ...a.data }); } },
    };
    const rec: any[] = [];
    const s = new ApplyScheduleService(prisma, { record: (i: any) => { rec.push(i); return Promise.resolve(); } } as any);
    await s.createFreeze(
      { env: 'PROD', startsAt: '2026-09-30T00:00', endsAt: '2026-10-02T00:00', reason: '분기말 동결' } as any,
      { userId: 'a', name: 'A', role: 'ADMIN', department: '운영팀' } as any,
    );
    expect(created.startsAt.toISOString()).toBe('2026-09-29T15:00:00.000Z'); // KST 00:00 = UTC 전일 15:00
    expect(rec[0]).toMatchObject({ action: 'FREEZE_UPDATED', targetType: 'APPLY_SCHEDULE' });
  });

  it('createWindow rejects start >= end', async () => {
    const s = new ApplyScheduleService({} as any, { record: () => Promise.resolve() } as any);
    await expect(
      s.createWindow({ env: 'PROD', dayOfWeek: 2, startMinute: 240, endMinute: 120 } as any, { userId: 'a' } as any),
    ).rejects.toMatchObject({ response: { key: 'applySchedule.windowStartAfterEnd' } });
  });
});
