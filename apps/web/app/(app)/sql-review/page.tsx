'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUser } from '@/components/user-context';
import {
  listSqlReviewPolicy,
  updateSqlReviewPolicy,
  type SqlReviewLevel,
  type SqlReviewRuleRow,
  type TargetEnv,
} from '@/lib/api';
import { PageHeader } from '@/components/page-header';

const ENV_COLUMNS: TargetEnv[] = ['DEV', 'STAGING', 'PROD'];
const LEVEL_OPTIONS: SqlReviewLevel[] = ['DISABLED', 'INFO', 'WARN', 'BLOCK'];

const inputClass =
  'rounded-2xl bg-card px-2 py-1.5 text-xs font-semibold outline-none ring-1 ring-border-strong focus:ring-primary';

/** BLOCK은 위험 강조, DISABLED는 흐리게, 그 외(INFO/WARN)는 기본 톤. */
function levelClass(level: SqlReviewLevel): string {
  if (level === 'BLOCK') return `${inputClass} text-red-600 ring-red-200 dark:text-red-300 dark:ring-red-500/30`;
  if (level === 'DISABLED') return `${inputClass} text-muted`;
  return `${inputClass} text-ink`;
}

export default function SqlReviewPolicyPage() {
  const t = useTranslations('sqlReview');
  const tCommon = useTranslations('common');
  const { user, ready } = useUser();
  const [rules, setRules] = useState<SqlReviewRuleRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return listSqlReviewPolicy()
      .then(setRules)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    load();
  }, [ready, user, load]);

  async function changeLevel(ruleKey: string, env: TargetEnv, level: SqlReviewLevel) {
    if (!rules) return;
    setError('');
    const prev = rules;
    // 낙관적 업데이트: 즉시 반영 후 실패 시 되돌림
    setRules((curr) =>
      curr!.map((r) => (r.ruleKey === ruleKey ? { ...r, levels: { ...r.levels, [env]: level } } : r)),
    );
    try {
      await updateSqlReviewPolicy(env, ruleKey, level);
    } catch (err) {
      setRules(prev);
      setError((err as Error).message);
    }
  }

  if (!ready || !user) {
    return <p className="text-muted">{tCommon('loading')}</p>;
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

      <section>
        {!error && rules === null && <p className="text-muted">{tCommon('loading')}</p>}

        {rules !== null && rules.length === 0 && (
          <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <p className="text-muted">{t('emptyList')}</p>
          </div>
        )}

        {rules !== null && rules.length > 0 && (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold text-muted">
                  <th className="px-4 py-3">{t('ruleColumn')}</th>
                  {ENV_COLUMNS.map((env) => (
                    <th key={env} className="px-4 py-3">{env}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.map((rule) => (
                  <tr key={rule.ruleKey} className="bg-card">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-ink">{rule.ruleKey}</p>
                      <p className="mt-1 text-xs text-muted">{rule.message}</p>
                    </td>
                    {ENV_COLUMNS.map((env) => (
                      <td key={env} className="px-4 py-3">
                        <select
                          className={levelClass(rule.levels[env])}
                          value={rule.levels[env]}
                          onChange={(e) => changeLevel(rule.ruleKey, env, e.target.value as SqlReviewLevel)}
                        >
                          {LEVEL_OPTIONS.map((lv) => (
                            <option key={lv} value={lv}>{lv}</option>
                          ))}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
