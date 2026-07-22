import { Injectable } from '@nestjs/common';
import { Backup, BackupScope, BackupStatus, TargetDatabase } from '@prisma/client';
import { Connection } from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../crypto/encryption.util';
import { openTargetConnection } from '../target-database/target-connection';
import { affectedTables } from './sql-analyzer';

/** One table's pre-apply snapshot (stored inside Backup.payload as JSON). */
export interface TableSnapshot {
  name: string;
  existedBefore: boolean;
  schema?: string;
  dataIncluded?: boolean;
  rowCount?: number;
  columns?: string[];
  rows?: unknown[][];
}

export interface BackupPayload {
  tables: TableSnapshot[];
}

/** Public Backup view — payload is never serialized to clients. */
const BACKUP_PUBLIC_SELECT = {
  id: true,
  changeRequestId: true,
  targetDatabaseId: true,
  scope: true,
  status: true,
  location: true,
  sizeBytes: true,
  note: true,
  createdAt: true,
  executions: { select: { id: true, kind: true } },
} as const;

function maxRows(): number {
  const v = Number(process.env.BACKUP_MAX_ROWS);
  return Number.isFinite(v) && v > 0 ? v : 100_000;
}

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Snapshots the tables a change request will touch, just before applying.
   * Schema (SHOW CREATE TABLE) is always captured for existing tables; data is
   * captured only when row count ≤ BACKUP_MAX_ROWS (else schema-only + PARTIAL).
   * Tables that do not yet exist are recorded so a rollback can DROP them.
   */
  async createBackup(params: {
    changeRequestId: string;
    target: TargetDatabase;
    files: { content: string }[];
  }): Promise<Backup> {
    const limit = maxRows();
    const tables = affectedTables(params.files);

    const snapshots: TableSnapshot[] = [];
    let downgraded = false;

    const connection = await this.connect(params.target);
    try {
      for (const table of tables) {
        const snap = await this.snapshotTable(connection, params.target.database, table, limit);
        if (snap.existedBefore && snap.dataIncluded === false) downgraded = true;
        snapshots.push(snap);
      }
    } finally {
      await connection.end().catch(() => undefined);
    }

    const payload = JSON.stringify({ tables: snapshots } satisfies BackupPayload);
    const anyData = snapshots.some((s) => s.dataIncluded);

    return this.prisma.backup.create({
      data: {
        changeRequestId: params.changeRequestId,
        targetDatabaseId: params.target.id,
        scope: anyData ? BackupScope.SCHEMA_AND_DATA : BackupScope.SCHEMA_ONLY,
        status: downgraded ? BackupStatus.PARTIAL : BackupStatus.SUCCESS,
        payload,
        sizeBytes: Buffer.byteLength(payload, 'utf8'),
        note: downgraded
          ? '일부 테이블이 BACKUP_MAX_ROWS 초과로 데이터 없이 schema-only 로 저장되었습니다.'
          : null,
      },
    });
  }

  /** Backup list for a change request (payload excluded). */
  async listBackups(changeRequestId: string) {
    const rows = await this.prisma.backup.findMany({
      where: { changeRequestId },
      orderBy: { createdAt: 'desc' },
      select: BACKUP_PUBLIC_SELECT,
    });
    // Surface the creating APPLY execution's id (a backup may also be referenced
    // by later ROLLBACK executions).
    return rows.map(({ executions, ...rest }) => ({
      ...rest,
      executionId: executions.find((e) => e.kind === 'APPLY')?.id ?? executions[0]?.id ?? null,
    }));
  }

  /** Parses the stored snapshot payload (internal — used by rollback). */
  async loadPayload(backupId: string): Promise<BackupPayload> {
    const backup = await this.prisma.backup.findUniqueOrThrow({
      where: { id: backupId },
      select: { payload: true },
    });
    return JSON.parse(backup.payload) as BackupPayload;
  }

  private async snapshotTable(
    connection: Connection,
    database: string,
    table: string,
    limit: number,
  ): Promise<TableSnapshot> {
    const [existsRows] = await connection.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
      [database, table],
    );
    if ((existsRows as unknown[]).length === 0) {
      return { name: table, existedBefore: false };
    }

    const [createRows] = await connection.query('SHOW CREATE TABLE ??', [table]);
    const schema = (createRows as Array<Record<string, string>>)[0]?.['Create Table'];

    const [countRows] = await connection.query('SELECT COUNT(*) AS c FROM ??', [table]);
    const rowCount = Number((countRows as Array<{ c: number }>)[0]?.c ?? 0);

    if (rowCount > limit) {
      return { name: table, existedBefore: true, schema, dataIncluded: false, rowCount };
    }

    const [dataRows, fields] = await connection.query('SELECT * FROM ??', [table]);
    const columns = (fields as Array<{ name: string }>).map((f) => f.name);
    const rows = (dataRows as Array<Record<string, unknown>>).map((r) => columns.map((c) => r[c]));
    return { name: table, existedBefore: true, schema, dataIncluded: true, rowCount, columns, rows };
  }

  private connect(target: TargetDatabase): Promise<Connection> {
    return openTargetConnection({
      host: target.host,
      port: target.port,
      username: target.username,
      password: decryptSecret(target.passwordEnc),
      database: target.database,
    });
  }
}
