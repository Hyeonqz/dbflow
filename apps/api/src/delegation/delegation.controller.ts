import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DelegationService } from './delegation.service';
import { CreateDelegationDto } from './dto/delegation.dto';

@Controller('delegations')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DelegationController {
  constructor(private readonly svc: DelegationService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list({ userId: user.userId, role: user.role });
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateDelegationDto) {
    return this.svc.createDelegation(dto, { userId: user.userId, name: user.name, role: user.role, department: user.department });
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteDelegation(id, { userId: user.userId, name: user.name, role: user.role, department: user.department });
  }
}
