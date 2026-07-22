import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, DbType, Prisma, Role, TargetDatabase, TargetEnv } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../crypto/encryption.util';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';
import { CreateTargetDatabaseDto } from './dto/create-target-database.dto';
import { UpdateTargetDatabaseDto } from './dto/update-target-database.dto';
import { openTargetConnection } from './target-connection';

/** Public view of a target database — credentials are stripped. */
export type SanitizedTargetDatabase = Omit<TargetDatabase, 'passwordEnc'>;

/** Identity used to scope reads — DEVELOPER sees DEV targets only (contract §3.3/§3.4). */
export interface RegistryActor {
  userId: string;
  role: Role;
}

export interface TestConnectionResult {
  success: boolean;
  serverVersion?: string;
  latencyMs?: number;
  error?: string;
}

@Injectable()
export class TargetDatabaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateTargetDatabaseDto,
    actor: AuditActorSnapshot,
  ): Promise<SanitizedTargetDatabase> {
    const created = await this.prisma.targetDatabase.create({
      data: {
        name: dto.name,
        env: dto.env,
        dbType: dto.dbType ?? DbType.MYSQL,
        host: dto.host,
        port: dto.port,
        username: dto.username,
        passwordEnc: encryptSecret(dto.password),
        database: dto.database,
      },
    });
    await this.audit.record({
      actor,
      action: AuditAction.TARGET_DB_CREATED,
      targetType: AuditTargetType.TARGET_DATABASE,
      targetId: created.id,
      summary: `대상DB 생성: ${created.name}`,
      metadata: { env: created.env, dbType: created.dbType, host: created.host },
    });
    return this.sanitize(created);
  }

  async list(actor: RegistryActor): Promise<SanitizedTargetDatabase[]> {
    const rows = await this.prisma.targetDatabase.findMany({
      where: this.visibilityWhere(actor),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.sanitize(row));
  }

  async findOne(actor: RegistryActor, id: string): Promise<SanitizedTargetDatabase> {
    // DEVELOPER may only see DEV targets; anything else is reported as 404 so a
    // non-DEV target's existence is not disclosed.
    const target = await this.prisma.targetDatabase.findFirst({
      where: { id, ...this.visibilityWhere(actor) },
    });
    if (!target) {
      throw new NotFoundException('대상 데이터베이스를 찾을 수 없습니다.');
    }
    return this.sanitize(target);
  }

  async update(
    id: string,
    dto: UpdateTargetDatabaseDto,
    actor: AuditActorSnapshot,
  ): Promise<SanitizedTargetDatabase> {
    await this.getOrThrow(id);
    const data: Prisma.TargetDatabaseUpdateInput = {
      name: dto.name,
      env: dto.env,
      dbType: dto.dbType,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      database: dto.database,
    };
    // Re-encrypt only when a new password is supplied; otherwise leave it intact.
    if (dto.password !== undefined) {
      data.passwordEnc = encryptSecret(dto.password);
    }
    const updated = await this.prisma.targetDatabase.update({ where: { id }, data });
    // NEVER log the password/passwordEnc value — only whether it changed.
    await this.audit.record({
      actor,
      action: AuditAction.TARGET_DB_UPDATED,
      targetType: AuditTargetType.TARGET_DATABASE,
      targetId: id,
      summary: `대상DB 수정: ${updated.name}`,
      metadata: { credentialChanged: dto.password != null },
    });
    return this.sanitize(updated);
  }

  async remove(id: string, actor: AuditActorSnapshot): Promise<{ id: string; deleted: true }> {
    await this.getOrThrow(id);
    await this.prisma.targetDatabase.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: AuditAction.TARGET_DB_DELETED,
      targetType: AuditTargetType.TARGET_DATABASE,
      targetId: id,
      summary: '대상DB 삭제',
    });
    return { id, deleted: true };
  }

  /** Decrypts the stored credential and probes the live database (SELECT VERSION()). */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const target = await this.getOrThrow(id);
    if (target.dbType !== DbType.MYSQL) {
      return { success: false, error: 'MVP는 MYSQL 대상만 연결을 지원합니다.' };
    }

    const startedAt = Date.now();
    let connection;
    try {
      connection = await openTargetConnection({
        host: target.host,
        port: target.port,
        username: target.username,
        password: decryptSecret(target.passwordEnc),
        database: target.database,
      });
      const [rows] = await connection.query('SELECT VERSION() AS version');
      const serverVersion = (rows as Array<{ version: string }>)[0]?.version;
      return { success: true, serverVersion, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }

  /**
   * Internal accessor returning the FULL record (incl. `passwordEnc`) with the
   * same visibility scoping as {@link findOne}. For server-side consumers that
   * must open a live connection (e.g. the schema-diff engine); never serialize
   * the result to a client.
   */
  async getEntityForActor(actor: RegistryActor, id: string): Promise<TargetDatabase> {
    const target = await this.prisma.targetDatabase.findFirst({
      where: { id, ...this.visibilityWhere(actor) },
    });
    if (!target) {
      throw new NotFoundException('대상 데이터베이스를 찾을 수 없습니다.');
    }
    return target;
  }

  // --- internals -----------------------------------------------------------

  /** DEVELOPER is scoped to DEV targets; APPROVER sees everything. */
  private visibilityWhere(actor: RegistryActor): Prisma.TargetDatabaseWhereInput {
    return actor.role === Role.APPROVER ? {} : { env: TargetEnv.DEV };
  }

  private async getOrThrow(id: string): Promise<TargetDatabase> {
    const target = await this.prisma.targetDatabase.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException('대상 데이터베이스를 찾을 수 없습니다.');
    }
    return target;
  }

  /** Strips the encrypted credential so it never reaches a response. */
  private sanitize(target: TargetDatabase): SanitizedTargetDatabase {
    const { passwordEnc: _passwordEnc, ...rest } = target;
    return rest;
  }
}
