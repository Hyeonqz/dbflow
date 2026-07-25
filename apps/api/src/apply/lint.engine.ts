import { SqlReviewLevel, TargetEnv } from '@prisma/client';
import { AnalyzedStatement, analyzeSql } from './sql-analyzer';

export type PolicyMap = Map<string, SqlReviewLevel>;

export type LintSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface LintItem {
  filename: string;
  line: number;
  rule: string;
  severity: LintSeverity;
  message: string;
}

export interface LintResult {
  items: LintItem[];
  maxSeverity: LintSeverity;
}

export interface LintFileInput {
  filename: string;
  content: string;
}

const SEVERITY_ORDER: Record<LintSeverity, number> = { INFO: 0, WARN: 1, BLOCK: 2 };

interface Rule {
  rule: string;
  base: LintSeverity;
  message: string;
  matches(stmt: AnalyzedStatement): boolean;
}

const RULES: Rule[] = [
  {
    rule: 'DROP_DATABASE',
    base: 'BLOCK',
    message: 'DROP DATABASE deletes the entire database.',
    matches: (s) => s.kind === 'DROP_DATABASE',
  },
  {
    rule: 'DROP_TABLE',
    base: 'BLOCK',
    message: 'DROP TABLE deletes the table and all of its data.',
    matches: (s) => s.kind === 'DROP_TABLE',
  },
  {
    rule: 'TRUNCATE',
    base: 'BLOCK',
    message: 'TRUNCATE deletes every row in the table (irreversible).',
    matches: (s) => s.kind === 'TRUNCATE',
  },
  {
    rule: 'DELETE_WITHOUT_WHERE',
    base: 'BLOCK',
    message: 'DELETE without a WHERE clause deletes every row in the table.',
    matches: (s) => s.kind === 'DELETE' && !s.hasWhere,
  },
  {
    rule: 'UPDATE_WITHOUT_WHERE',
    base: 'BLOCK',
    message: 'UPDATE without a WHERE clause modifies every row in the table.',
    matches: (s) => s.kind === 'UPDATE' && !s.hasWhere,
  },
  {
    rule: 'ALTER_DROP_COLUMN',
    base: 'WARN',
    message: "Dropping a column loses that column's data.",
    matches: (s) => s.kind === 'ALTER_TABLE' && s.alterDropColumn,
  },
  {
    rule: 'DROP_INDEX',
    base: 'INFO',
    message: 'Dropping an index may affect query performance.',
    matches: (s) => s.kind === 'DROP_INDEX' || (s.kind === 'ALTER_TABLE' && s.alterDropIndex),
  },
];

export const RULE_CATALOG: { ruleKey: string; base: LintSeverity; message: string }[] =
  RULES.map((r) => ({ ruleKey: r.rule, base: r.base, message: r.message }));

/**
 * Maps a rule's base severity to its effective severity for an environment:
 * DEV downgrades BLOCK → WARN (fast iteration, never blocked); STAGING/PROD keep
 * the base severity (contract §3.2).
 */
export function effectiveSeverity(base: LintSeverity, env: TargetEnv): LintSeverity {
  if (env === TargetEnv.DEV && base === 'BLOCK') return 'WARN';
  return base;
}

/** Lints every statement of every file, applying the policy map (per-rule severity). */
export function lintFiles(files: LintFileInput[], policy: PolicyMap): LintResult {
  const items: LintItem[] = [];
  for (const file of files) {
    for (const stmt of analyzeSql(file.content)) {
      for (const rule of RULES) {
        if (!rule.matches(stmt)) continue;
        const level = policy.get(rule.rule);
        if (level === 'DISABLED' || level == null) continue; // DISABLED 또는 결손 → 미보고
        items.push({
          filename: file.filename,
          line: stmt.line,
          rule: rule.rule,
          severity: level as LintSeverity,
          message: rule.message,
        });
      }
    }
  }
  const maxSeverity = items.reduce<LintSeverity>(
    (max, i) => (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[max] ? i.severity : max),
    'INFO',
  );
  return { items, maxSeverity };
}

/** True if any item is an effective BLOCK (used to gate STAGING/PROD applies). */
export function hasBlock(result: LintResult): boolean {
  return result.maxSeverity === 'BLOCK';
}
