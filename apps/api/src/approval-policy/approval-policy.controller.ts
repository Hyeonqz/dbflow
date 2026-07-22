import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApprovalPolicyService } from './approval-policy.service';
import { UpdateApprovalPolicyDto } from './dto/update-approval-policy.dto';

@Controller('approval-policy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ApprovalPolicyController {
  constructor(private readonly svc: ApprovalPolicyService) {}

  @Get()
  list() { return this.svc.list(); }        // 로그인 사용자 누구나(생성 폼용)

  @Patch()
  @Roles(Role.ADMIN)                         // 메서드 레벨 — PATCH만 ADMIN
  update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateApprovalPolicyDto) {
    return this.svc.update(dto.env, dto.requiredApprovals, {
      userId: user.userId, name: user.name, role: user.role, department: user.department,
    });
  }
}
