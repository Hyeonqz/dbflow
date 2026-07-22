import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TargetDatabase } from '@prisma/client';
import { Connection } from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../crypto/encryption.util';
import { openTargetConnection } from '../target-database/target-connection';
import { AnalyzedStatement, analyzeSql } from './sql-analyzer';
import { assertApplyPermission, assertEnvMatch, SafetyActor } from './apply-policy';
import { DryRunDto } from './dto/dry-run.dto';

export type DryRunMode = 'DML_TX_ROLLBACK' | 'DDL_STATIC';

export interface DryRunFileResult {
  filename: string;
  mode: DryRunMode;
  affectedRows?: number;
  impact: string;
  destructive: boolean;
  error?: string;
}

export interface DryRunResult {
  changeRequestId: string;
  targetDatabaseId: string;
  perFile: DryRunFileResult[];
}

type FileToRun = { filename: string; content: string };

@Injectable()
export class DryRunService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Previews the impact of applying a CR without committing anything: pure-DML
   * files run inside a transaction that is always rolled back (to measure
   * affectedRows); DDL files are classified statically and never executed
   * (DDL auto-commits in MySQL). See contract §4.
   */
  async dryRun(actor: SafetyActor, changeRequestId: string, dto: DryRunDto): Promise<DryRunResult> {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id: changeRequestId },
      include: { files: { orderBy: { order: 'asc' } } },
    });
    if (!changeRequest) {
      throw new NotFoundException('변경요청을 찾을 수 없습니다.');
    }

    const target = await this.prisma.targetDatabase.findUnique({
      where: { id: dto.targetDatabaseId },
    });
    if (!target) {
      throw new NotFoundException('대상 데이터베이스를 찾을 수 없습니다.');
    }

    assertEnvMatch(changeRequest.targetEnv, target.env);
    assertApplyPermission(actor, target.env, changeRequest.authorId);
    if (target.dbType !== 'MYSQL') {
      throw new ConflictException('MVP는 MYSQL 대상만 dry-run을 지원합니다.');
    }

    const connection = await this.connect(target);
    try {
      const perFile: DryRunFileResult[] = [];
      for (const file of changeRequest.files) {
        perFile.push(await this.dryRunFile(connection, file));
      }
      return { changeRequestId, targetDatabaseId: target.id, perFile };
    } finally {
      await connection.end().catch(() => undefined);
    }
  }

  private async dryRunFile(connection: Connection, file: FileToRun): Promise<DryRunFileResult> {
    const statements = analyzeSql(file.content);
    const hasDdl = statements.some((s) => s.isDdl);
    const destructive = statements.some((s) => isDestructive(s));
    const impact = summarizeImpact(statements);

    if (hasDdl) {
      // DDL auto-commits — never execute during a dry-run.
      return { filename: file.filename, mode: 'DDL_STATIC', impact, destructive };
    }

    // Pure DML: run inside a transaction and roll back to measure impact safely.
    try {
      await connection.beginTransaction();
      let affectedRows = 0;
      for (const stmt of statements) {
        if (stmt.kind === 'SELECT' || stmt.kind === 'OTHER') continue;
        const [result] = await connection.query(stmt.raw);
        affectedRows += (result as { affectedRows?: number })?.affectedRows ?? 0;
      }
      return { filename: file.filename, mode: 'DML_TX_ROLLBACK', affectedRows, impact, destructive };
    } catch (err) {
      return {
        filename: file.filename,
        mode: 'DML_TX_ROLLBACK',
        impact,
        destructive,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await connection.rollback().catch(() => undefined);
    }
  }

  private async connect(target: TargetDatabase): Promise<Connection> {
    return openTargetConnection(
      {
        host: target.host,
        port: target.port,
        username: target.username,
        password: decryptSecret(target.passwordEnc),
        database: target.database,
      },
      { multipleStatements: false },
    );
  }
}

function isDestructive(s: AnalyzedStatement): boolean {
  if (s.kind === 'DROP_TABLE' || s.kind === 'DROP_DATABASE' || s.kind === 'TRUNCATE') return true;
  if (s.kind === 'ALTER_TABLE' && s.alterDropColumn) return true;
  if ((s.kind === 'DELETE' || s.kind === 'UPDATE') && !s.hasWhere) return true;
  return false;
}

function summarizeImpact(statements: AnalyzedStatement[]): string {
  return statements
    .filter((s) => s.kind !== 'OTHER')
    .map((s) => {
      const table = s.table ? ` ${s.table}` : '';
      if (s.kind === 'ALTER_TABLE') {
        const ops = [
          s.alterAddColumn ? 'ADD COLUMN' : null,
          s.alterDropColumn ? 'DROP COLUMN' : null,
          s.alterDropIndex ? 'DROP INDEX' : null,
        ].filter(Boolean);
        return `ALTER TABLE${table}${ops.length ? ` (${ops.join(', ')})` : ''}`;
      }
      return `${s.kind.replace(/_/g, ' ')}${table}`;
    })
    .join('; ');
}
