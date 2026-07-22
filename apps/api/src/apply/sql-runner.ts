import { Connection } from 'mysql2/promise';

export interface FileRunResult {
  rowsAffected: number;
  durationMs: number;
}

/**
 * Executes one migration file's SQL on an open connection and reports how many
 * rows it affected and how long it took. A file may contain multiple statements
 * (the connection is opened with `multipleStatements: true`), so the affected
 * counts are summed across all result headers.
 */
export async function runSqlFile(connection: Connection, sql: string): Promise<FileRunResult> {
  const startedAt = Date.now();
  const [result] = await connection.query(sql);
  return { rowsAffected: extractRowsAffected(result), durationMs: Date.now() - startedAt };
}

function extractRowsAffected(result: unknown): number {
  if (Array.isArray(result)) {
    return result.reduce<number>((sum, header) => sum + affectedRowsOf(header), 0);
  }
  return affectedRowsOf(result);
}

function affectedRowsOf(header: unknown): number {
  const value = (header as { affectedRows?: unknown })?.affectedRows;
  return typeof value === 'number' ? value : 0;
}
