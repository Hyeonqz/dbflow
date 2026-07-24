'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useUser } from '@/components/user-context';
import {
  createApplyWindow,
  createFreeze,
  deleteApplyWindow,
  deleteFreeze,
  getApplySchedule,
  type ApplySchedule,
  type TargetEnv,
} from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { formatKstDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';

const ENV_OPTIONS: TargetEnv[] = ['DEV', 'STAGING', 'PROD'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const inputClass =
  'w-full rounded-2xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-border-strong focus:ring-primary';

/** 분(0~1440) → "HH:mm" 표시. 1440(자정)은 "24:00"으로 표시. */
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function ApplySchedulePage() {
  const t = useTranslations('applySchedule');
  const tc = useTranslations('common');
  const { user, ready } = useUser();
  const [schedule, setSchedule] = useState<ApplySchedule | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return getApplySchedule()
      .then(setSchedule)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    load();
  }, [ready, user, load]);

  if (!ready || !user) {
    return <p className="text-muted">{tc('loading')}</p>;
  }

  if (user.role !== 'ADMIN') {
    return <p className="rounded-2xl bg-card px-6 py-5 text-muted ring-1 ring-border">{t('accessDenied')}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
      />

      {error && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {schedule && schedule.timezone !== 'Asia/Seoul' && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {t('timezoneMismatch', { timezone: schedule.timezone })}
        </p>
      )}

      {!error && schedule === null && <p className="text-muted">{tc('loading')}</p>}

      {schedule && (
        <>
          <WindowsSection schedule={schedule} onError={setError} onChanged={load} />
          <FreezesSection schedule={schedule} onError={setError} onChanged={load} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 작업창 섹션 — 목록 + 등록 폼
// ---------------------------------------------------------------------------
function WindowsSection({
  schedule,
  onError,
  onChanged,
}: {
  schedule: ApplySchedule;
  onError: (msg: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('applySchedule');
  const tc = useTranslations('common');
  const fid = useId();
  const [env, setEnv] = useState<TargetEnv>('DEV');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    const [sh, sm] = startTime.split(':').map(Number);
    const startMinute = sh * 60 + sm;
    // 종료 00:00은 자정(24:00)을 의미하므로 1440으로 매핑
    const endMinute = endTime === '00:00' ? 1440 : (() => {
      const [eh, em] = endTime.split(':').map(Number);
      return eh * 60 + em;
    })();

    setBusy(true);
    try {
      await createApplyWindow({ env, dayOfWeek, startMinute, endMinute });
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    onError('');
    try {
      await deleteApplyWindow(id);
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">{t('windowsHeading')}</h2>

      {schedule.windows.length === 0 && (
        <div className="rounded-2xl bg-card px-6 py-8 text-center ring-1 ring-border">
          <p className="text-muted">{t('windowsEmpty')}</p>
        </div>
      )}

      {schedule.windows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-muted">
                <th className="px-4 py-3">{t('envLabel')}</th>
                <th className="px-4 py-3">{t('dayLabel')}</th>
                <th className="px-4 py-3">{t('startEndLabel')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schedule.windows.map((w) => (
                <tr key={w.id} className="bg-card">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{w.env}</td>
                  <td className="px-4 py-3 text-ink">{t(`day.${DAY_KEYS[w.dayOfWeek]}`)}</td>
                  <td className="px-4 py-3 tabular-nums text-ink">{fmtMin(w.startMinute)} ~ {fmtMin(w.endMinute)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(w.id)}
                      className="focusable rounded-2xl bg-card px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
                    >
                      {tc('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <label htmlFor={`${fid}-env`} className="mb-1 block text-xs font-semibold text-muted">{t('envLabel')}</label>
            <select id={`${fid}-env`} className={inputClass} value={env} onChange={(e) => setEnv(e.target.value as TargetEnv)}>
              {ENV_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-day`} className="mb-1 block text-xs font-semibold text-muted">{t('dayLabel')}</label>
            <select id={`${fid}-day`} className={inputClass} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
              {DAY_KEYS.map((key, idx) => (
                <option key={idx} value={idx}>{t(`day.${key}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-start`} className="mb-1 block text-xs font-semibold text-muted">{t('startLabel')}</label>
            <input id={`${fid}-start`} type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${fid}-end`} className="mb-1 block text-xs font-semibold text-muted">{t('endLabel')}</label>
            <input id={`${fid}-end`} type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            <p className="mt-1 text-xs text-muted">{t('endMidnightHint')}</p>
          </div>
          <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
            {busy ? t('addingWindow') : t('addWindowButton')}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 동결 섹션 — 목록 + 등록 폼
// ---------------------------------------------------------------------------
function FreezesSection({
  schedule,
  onError,
  onChanged,
}: {
  schedule: ApplySchedule;
  onError: (msg: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('applySchedule');
  const tc = useTranslations('common');
  const fid = useId();
  const locale = useLocale() as Locale;
  const [env, setEnv] = useState<TargetEnv>('DEV');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    if (!startsAt || !endsAt || !reason.trim()) {
      onError(t('freezeValidation'));
      return;
    }
    setBusy(true);
    try {
      await createFreeze({ env, startsAt, endsAt, reason: reason.trim() });
      setStartsAt('');
      setEndsAt('');
      setReason('');
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    onError('');
    try {
      await deleteFreeze(id);
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">{t('freezesHeading')}</h2>

      {schedule.freezes.length === 0 && (
        <div className="rounded-2xl bg-card px-6 py-8 text-center ring-1 ring-border">
          <p className="text-muted">{t('freezesEmpty')}</p>
        </div>
      )}

      {schedule.freezes.length > 0 && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-muted">
                <th className="px-4 py-3">{t('envLabel')}</th>
                <th className="px-4 py-3">{t('periodKstLabel')}</th>
                <th className="px-4 py-3">{t('reasonLabel')}</th>
                <th className="px-4 py-3">{t('createdByLabel')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schedule.freezes.map((f) => (
                <tr key={f.id} className="bg-card">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{f.env}</td>
                  <td className="px-4 py-3 tabular-nums text-ink">{formatKstDateTime(f.startsAt, locale)} ~ {formatKstDateTime(f.endsAt, locale)}</td>
                  <td className="px-4 py-3 text-muted">{f.reason}</td>
                  <td className="px-4 py-3 text-muted">{f.createdBy?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(f.id)}
                      className="focusable rounded-2xl bg-card px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/15"
                    >
                      {t('release')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <label htmlFor={`${fid}-env`} className="mb-1 block text-xs font-semibold text-muted">{t('envLabel')}</label>
            <select id={`${fid}-env`} className={inputClass} value={env} onChange={(e) => setEnv(e.target.value as TargetEnv)}>
              {ENV_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-starts`} className="mb-1 block text-xs font-semibold text-muted">{t('startLabel')}</label>
            <input id={`${fid}-starts`} type="datetime-local" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${fid}-ends`} className="mb-1 block text-xs font-semibold text-muted">{t('endLabel')}</label>
            <input id={`${fid}-ends`} type="datetime-local" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${fid}-reason`} className="mb-1 block text-xs font-semibold text-muted">{t('reasonLabel')}</label>
            <input id={`${fid}-reason`} className={inputClass} placeholder={t('reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
            {busy ? t('addingFreeze') : t('addFreezeButton')}
          </button>
        </div>
      </form>
    </section>
  );
}
