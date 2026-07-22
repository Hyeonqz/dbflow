/**
 * Lightweight static SQL analyzer shared by the lint engine, dry-run, and the
 * backup engine. It is deliberately regex-based (no full parser) — see the
 * limitations noted in docs/plan5-apply-safety-contract.md.
 */

export type StatementKind =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'CREATE_TABLE'
  | 'DROP_TABLE'
  | 'TRUNCATE'
  | 'ALTER_TABLE'
  | 'CREATE_DATABASE'
  | 'DROP_DATABASE'
  | 'CREATE_INDEX'
  | 'DROP_INDEX'
  | 'OTHER';

export interface AnalyzedStatement {
  raw: string;
  /** 1-based line number of the statement within its file. */
  line: number;
  kind: StatementKind;
  /** Primary table the statement acts on (backtick-stripped), if any. */
  table: string | null;
  isDdl: boolean;
  /** For UPDATE/DELETE: whether a WHERE clause is present anywhere. */
  hasWhere: boolean;
  alterDropColumn: boolean;
  alterAddColumn: boolean;
  alterDropIndex: boolean;
}

const DDL_KINDS: ReadonlySet<StatementKind> = new Set<StatementKind>([
  'CREATE_TABLE',
  'DROP_TABLE',
  'TRUNCATE',
  'ALTER_TABLE',
  'CREATE_DATABASE',
  'DROP_DATABASE',
  'CREATE_INDEX',
  'DROP_INDEX',
]);

/** Strips comments and splits into statements, tracking each one's start line. */
export function splitSqlStatements(sql: string): { raw: string; line: number }[] {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // keep newlines
    .replace(/--[^\n]*/g, '')
    .replace(/#[^\n]*/g, '');

  const statements: { raw: string; line: number }[] = [];
  let current = '';
  let line = 1;
  let startLine = 1;
  let started = false;

  for (const ch of cleaned) {
    if (!started && /\S/.test(ch)) {
      started = true;
      startLine = line;
    }
    if (ch === ';') {
      if (current.trim()) statements.push({ raw: current.trim(), line: startLine });
      current = '';
      started = false;
    } else {
      current += ch;
    }
    if (ch === '\n') line++;
  }
  if (current.trim()) statements.push({ raw: current.trim(), line: startLine });
  return statements;
}

const TABLE = '[`"]?([A-Za-z0-9_]+)[`"]?';

export function analyzeStatement(raw: string, line = 1): AnalyzedStatement {
  const s = raw.trim();
  const base: AnalyzedStatement = {
    raw: s,
    line,
    kind: 'OTHER',
    table: null,
    isDdl: false,
    hasWhere: /\bWHERE\b/i.test(s),
    alterDropColumn: false,
    alterAddColumn: false,
    alterDropIndex: false,
  };

  let m: RegExpMatchArray | null;
  if (/^DROP\s+DATABASE/i.test(s)) return { ...base, kind: 'DROP_DATABASE', isDdl: true };
  if (/^CREATE\s+DATABASE/i.test(s)) return { ...base, kind: 'CREATE_DATABASE', isDdl: true };
  if ((m = s.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${TABLE}`, 'i'))))
    return { ...base, kind: 'DROP_TABLE', table: m[1], isDdl: true };
  if ((m = s.match(new RegExp(`^TRUNCATE\\s+(?:TABLE\\s+)?${TABLE}`, 'i'))))
    return { ...base, kind: 'TRUNCATE', table: m[1], isDdl: true };
  if ((m = s.match(new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TABLE}`, 'i'))))
    return { ...base, kind: 'CREATE_TABLE', table: m[1], isDdl: true };
  if ((m = s.match(new RegExp(`^ALTER\\s+TABLE\\s+${TABLE}`, 'i')))) {
    return {
      ...base,
      kind: 'ALTER_TABLE',
      table: m[1],
      isDdl: true,
      alterDropColumn: /\bDROP\s+COLUMN\b/i.test(s) || /\bDROP\s+[`"]?[A-Za-z0-9_]+[`"]?\s*$/i.test(s),
      alterAddColumn: /\bADD\s+(?:COLUMN\b|[`"]?[A-Za-z0-9_]+[`"]?\s)/i.test(s),
      alterDropIndex: /\bDROP\s+(?:INDEX|KEY)\b/i.test(s),
    };
  }
  if (/^DROP\s+INDEX/i.test(s)) return { ...base, kind: 'DROP_INDEX', isDdl: true, alterDropIndex: true };
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(s)) return { ...base, kind: 'CREATE_INDEX', isDdl: true };
  if ((m = s.match(new RegExp(`^UPDATE\\s+${TABLE}`, 'i'))))
    return { ...base, kind: 'UPDATE', table: m[1] };
  if ((m = s.match(new RegExp(`^DELETE\\s+FROM\\s+${TABLE}`, 'i'))))
    return { ...base, kind: 'DELETE', table: m[1] };
  if ((m = s.match(new RegExp(`^INSERT\\s+(?:IGNORE\\s+)?INTO\\s+${TABLE}`, 'i'))))
    return { ...base, kind: 'INSERT', table: m[1] };
  if (/^SELECT\b/i.test(s)) return { ...base, kind: 'SELECT' };
  return base;
}

export function analyzeSql(sql: string): AnalyzedStatement[] {
  return splitSqlStatements(sql).map((s) => analyzeStatement(s.raw, s.line));
}

export function isDdlKind(kind: StatementKind): boolean {
  return DDL_KINDS.has(kind);
}

/** Distinct tables touched across files (for backup/dry-run impact analysis). */
export function affectedTables(files: { content: string }[]): string[] {
  const tables = new Set<string>();
  for (const file of files) {
    for (const stmt of analyzeSql(file.content)) {
      if (stmt.table) tables.add(stmt.table);
    }
  }
  return [...tables];
}
