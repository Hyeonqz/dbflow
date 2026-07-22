import { Controller, Get, Logger, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService, AUDIT_EXPORT_MAX_ROWS } from './audit.service';
import { QueryAuditExportDto } from './dto/query-audit-export.dto';
import { QueryAuditDto } from './dto/query-audit.dto';

@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  private readonly logger = new Logger(AuditController.name);
  constructor(private readonly audit: AuditService) {}

  @Get('export')
  async export(@Query() q: QueryAuditExportDto, @Res() res: Response) {
    const rows = await this.audit.exportRows(q);
    if (rows.length >= AUDIT_EXPORT_MAX_ROWS) {
      this.logger.warn(`audit export truncated at ${AUDIT_EXPORT_MAX_ROWS} rows`);
      res.setHeader('X-Audit-Export-Truncated', 'true');
    }
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return res.send(this.audit.toCsv(rows));
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.json"');
    return res.send(JSON.stringify(rows));
  }

  @Get()
  list(@Query() q: QueryAuditDto) {
    return this.audit.list(q);
  }
}
