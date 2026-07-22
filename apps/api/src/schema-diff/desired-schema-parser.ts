import { ColumnDef, IndexDef, Schema, TableDef, normalizeType } from './schema-model';

/**
 * Minimal `CREATE TABLE` parser producing the normalized {@link Schema} model.
 * Intentionally narrow (see docs/plan4-schema-diff-contract.md §4.2):
 *  - only `CREATE TABLE [IF NOT EXISTS] name ( ... )` is understood;
 *  - columns: name, type, NULL/NOT NULL, inline PRIMARY KEY;
 *  - indexes: PRIMARY KEY (...), [UNIQUE] KEY|INDEX name (...) — names required;
 *  - FOREIGN KEY/CONSTRAINT/CHECK and table options are ignored.
 */
export function parseDesiredSchema(sql: string): Schema {
  const schema: Schema = new Map();
  const cleaned = stripComments(sql);

  for (const statement of splitStatements(cleaned)) {
    const table = parseCreateTable(statement);
    if (table) {
      schema.set(table.name, table);
    }
  }
  return schema;
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' ') // -- line comments
    .replace(/#[^\n]*/g, ' '); // # line comments
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseCreateTable(statement: string): TableDef | null {
  const header = statement.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s*\(/i,
  );
  if (!header) return null;

  const openParen = statement.indexOf('(', header.index! + header[0].length - 1);
  const body = extractParenBody(statement, openParen);
  if (body === null) return null;

  const table: TableDef = {
    name: header[1],
    columns: [],
    indexes: [],
    rawCreateStatement: `${statement.trim()};`,
  };

  for (const part of splitTopLevel(body)) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const index = parseIndexDefinition(trimmed);
    if (index) {
      table.indexes.push(index);
      continue;
    }
    if (/^(?:CONSTRAINT|FOREIGN\s+KEY|CHECK)\b/i.test(trimmed)) {
      continue; // unsupported — skipped per contract §4.2
    }
    const column = parseColumnDefinition(trimmed);
    if (column) {
      table.columns.push(column.column);
      if (column.inlinePrimaryKey) {
        table.indexes.push({ name: 'PRIMARY', columns: [column.column.name], unique: true });
      }
    }
  }

  return table;
}

/** Returns the content between the paren at `openIdx` and its matching close. */
function extractParenBody(str: string, openIdx: number): string | null {
  if (openIdx < 0 || str[openIdx] !== '(') return null;
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') {
      depth--;
      if (depth === 0) return str.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Splits a definition body on commas that are not nested inside parens. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseIndexDefinition(part: string): IndexDef | null {
  if (/^PRIMARY\s+KEY/i.test(part)) {
    return { name: 'PRIMARY', columns: parseIndexColumns(part), unique: true };
  }
  const unique = part.match(/^UNIQUE\s+(?:KEY|INDEX)?\s*[`"]?([A-Za-z0-9_]+)?[`"]?\s*\(/i);
  if (unique) {
    return { name: unique[1] ?? '', columns: parseIndexColumns(part), unique: true };
  }
  const plain = part.match(/^(?:KEY|INDEX)\s+[`"]?([A-Za-z0-9_]+)[`"]?\s*\(/i);
  if (plain) {
    return { name: plain[1], columns: parseIndexColumns(part), unique: false };
  }
  return null;
}

function parseIndexColumns(part: string): string[] {
  const open = part.indexOf('(');
  const body = extractParenBody(part, open);
  if (body === null) return [];
  return splitTopLevel(body)
    .map((c) => c.trim().match(/^[`"]?([A-Za-z0-9_]+)[`"]?/)?.[1])
    .filter((c): c is string => Boolean(c));
}

function parseColumnDefinition(
  part: string,
): { column: ColumnDef; inlinePrimaryKey: boolean } | null {
  const match = part.match(/^[`"]?([A-Za-z0-9_]+)[`"]?\s+([\s\S]+)$/);
  if (!match) return null;

  const name = match[1];
  const rest = match[2].trim();
  const typeMatch = rest.match(
    /^([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+unsigned)?(?:\s+zerofill)?)/i,
  );
  if (!typeMatch) return null;

  const inlinePrimaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);
  const nullable = !/\bNOT\s+NULL\b/i.test(rest) && !inlinePrimaryKey;

  return {
    column: {
      name,
      type: normalizeType(typeMatch[1]),
      nullable,
      raw: `\`${name}\` ${rest}`,
    },
    inlinePrimaryKey,
  };
}
