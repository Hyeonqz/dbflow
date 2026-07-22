import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RollbackService } from './rollback.service';

/**
 * Rollback endpoint (contract §6). Role-guarded for DEVELOPER|APPROVER; the
 * per-env detail (DEV author-developer vs. STAGING|PROD APPROVER-only) is
 * enforced in the service.
 */
@Controller('executions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RollbackController {
  constructor(private readonly service: RollbackService) {}

  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER, Role.APPROVER)
  rollback(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.rollback(user, id);
  }
}
