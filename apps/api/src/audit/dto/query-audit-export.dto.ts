import { IsIn, IsOptional } from 'class-validator';
import { QueryAuditDto } from './query-audit.dto';

export class QueryAuditExportDto extends QueryAuditDto {
  @IsOptional() @IsIn(['csv', 'json']) format?: 'csv' | 'json';
}
