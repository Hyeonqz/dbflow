import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplyService } from './apply.service';
import { DryRunService } from './dry-run.service';
import { BackupService } from './backup.service';
import { ApplyDto } from './dto/apply.dto';
import { DryRunDto } from './dto/dry-run.dto';

/**
 * Apply engine endpoints, nested under change-requests (contract §4/§5).
 * `apply`/`dry-run` are guarded at the role level for DEVELOPER|APPROVER; the
 * per-env detail (DEV author-developer vs. STAGING|PROD APPROVER-only) is
 * enforced in the service. `lint` is read-only static analysis available to
 * both roles.
 */
@Controller('change-requests')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ApplyController {
  constructor(
    private readonly service: ApplyService,
    private readonly dryRunService: DryRunService,
    private readonly backupService: BackupService,
  ) {}

  @Post(':id/lint')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER, Role.APPROVER)
  lint(@Param('id') id: string) {
    return this.service.lint(id);
  }

  @Post(':id/dry-run')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER, Role.APPROVER)
  dryRun(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DryRunDto,
  ) {
    return this.dryRunService.dryRun(user, id, dto);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER, Role.APPROVER)
  apply(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ApplyDto,
  ) {
    return this.service.apply(user, id, dto);
  }

  @Get(':id/executions')
  executions(@Param('id') id: string) {
    return this.service.listExecutions(id);
  }

  @Get(':id/backups')
  @Roles(Role.DEVELOPER, Role.APPROVER)
  backups(@Param('id') id: string) {
    return this.backupService.listBackups(id);
  }
}
