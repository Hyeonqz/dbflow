import { createConnection, Connection } from 'mysql2/promise';

/**
 * Decrypted connection parameters for a target database. Lives only in memory
 * for the duration of a connection attempt — never persisted or logged.
 */
export interface TargetConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Opens a mysql2 connection to a target database. `multipleStatements` is
 * enabled only for the apply engine, where a single migration file may contain
 * several statements; it stays off for connection tests.
 */
export function openTargetConnection(
  cfg: TargetConnectionConfig,
  opts: { multipleStatements?: boolean } = {},
): Promise<Connection> {
  return createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: opts.multipleStatements ?? false,
    connectTimeout: 10_000,
  });
}
