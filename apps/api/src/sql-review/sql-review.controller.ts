import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SqlReviewService } from './sql-review.service';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Controller('sql-review-policy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class SqlReviewController {
  constructor(private readonly svc: SqlReviewService) {}

  @Get()
  list() {
    return this.svc.listCatalogWithLevels();
  }

  @Patch()
  update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdatePolicyDto) {
    return this.svc.update(dto.env, dto.ruleKey, dto.level, {
      userId: user.userId, name: user.name, role: user.role, department: user.department,
    });
  }
}
