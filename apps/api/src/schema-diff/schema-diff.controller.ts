import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplySchemaDiffDto } from './dto/apply-schema-diff.dto';
import { PreviewSchemaDiffDto } from './dto/preview-schema-diff.dto';
import { SchemaDiffService } from './schema-diff.service';

/**
 * Schema-diff endpoints (contract §3/§5). Target visibility reuses Plan 3 rules
 * (DEVELOPER → DEV targets only), enforced in the service. Creating the CR is
 * DEVELOPER-only since they become its author.
 */
@Controller('schema-diff')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SchemaDiffController {
  constructor(private readonly service: SchemaDiffService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER, Role.APPROVER)
  preview(@CurrentUser() user: CurrentUserPayload, @Body() dto: PreviewSchemaDiffDto) {
    return this.service.preview(user, dto);
  }

  @Post('apply-to-change-request')
  @Roles(Role.DEVELOPER)
  applyToChangeRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ApplySchemaDiffDto,
  ) {
    return this.service.applyToChangeRequest(user, dto);
  }
}
