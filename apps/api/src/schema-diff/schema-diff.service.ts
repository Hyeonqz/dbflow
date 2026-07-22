import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DbType, SqlType, TargetDatabase } from '@prisma/client';
import { CurrentUserPayload } from '../auth/current-user.decorator';
import { decryptSecret } from '../crypto/encryption.util';
import { ChangeRequestService } from '../change-request/change-request.service';
import { TargetDatabaseService } from '../target-database/target-database.service';
import { openTargetConnection } from '../target-database/target-connection';
import { parseDesiredSchema } from './desired-schema-parser';
import { diffSchemas } from './schema-diff.engine';
import { introspectSchema } from './schema-introspector';
import { CurrentSnapshotSummary, DiffItem, Schema, summarize } from './schema-model';

export interface SchemaDiffPreview {
  targetDatabaseId: string;
  currentSnapshotSummary: CurrentSnapshotSummary;
  diff: DiffItem[];
  hasChanges: boolean;
}

@Injectable()
export class SchemaDiffService {
  constructor(
    private readonly targets: TargetDatabaseService,
    private readonly changeRequests: ChangeRequestService,
  ) {}

  /** Computes the desired→current diff without persisting anything (contract §3). */
  async preview(actor: CurrentUserPayload, dto: PreviewInput): Promise<SchemaDiffPreview> {
    const { target, current, diff } = await this.computeDiff(actor, dto);
    return {
      targetDatabaseId: target.id,
      currentSnapshotSummary: summarize(target.database, current),
      diff,
      hasChanges: diff.length > 0,
    };
  }

  /** Bundles the diff into a DRAFT ChangeRequest, reusing the Plan 2 service (§5). */
  async applyToChangeRequest(actor: CurrentUserPayload, dto: ApplyInput) {
    const { target, diff } = await this.computeDiff(actor, dto);
    if (diff.length === 0) {
      throw new ConflictException('스키마 차이가 없어 변경요청을 생성할 수 없습니다.');
    }

    const files = diff.map((item, index) => ({
      filename: `${String(index + 1).padStart(3, '0')}_${item.kind.toLowerCase()}.sql`,
      sqlType: SqlType.DDL,
      content: item.statement,
    }));

    return this.changeRequests.create(actor, {
      title: dto.title,
      description: dto.description,
      targetEnv: target.env,
      files,
    });
  }

  // --- internals -----------------------------------------------------------

  private async computeDiff(
    actor: CurrentUserPayload,
    dto: PreviewInput,
  ): Promise<{ target: TargetDatabase; current: Schema; diff: DiffItem[] }> {
    // Visibility-scoped: a developer can only target DEV databases (else 404).
    const target = await this.targets.getEntityForActor(actor, dto.targetDatabaseId);
    if (target.dbType !== DbType.MYSQL) {
      throw new ConflictException('MVP는 MYSQL 대상만 스키마 diff를 지원합니다.');
    }

    const desired = parseDesiredSchema(dto.desiredSchemaSql);
    if (desired.size === 0) {
      throw new BadRequestException(
        'desired SQL에서 CREATE TABLE 문을 찾지 못했습니다. (CREATE TABLE 형식만 지원)',
      );
    }

    const current = await this.introspect(target);
    return { target, current, diff: diffSchemas(desired, current) };
  }

  private async introspect(target: TargetDatabase): Promise<Schema> {
    let connection;
    try {
      connection = await openTargetConnection({
        host: target.host,
        port: target.port,
        username: target.username,
        password: decryptSecret(target.passwordEnc),
        database: target.database,
      });
      return await introspectSchema(connection, target.database);
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }
}

interface PreviewInput {
  targetDatabaseId: string;
  desiredSchemaSql: string;
}

interface ApplyInput extends PreviewInput {
  title: string;
  description: string;
}
