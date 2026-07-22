import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplyScheduleService } from './apply-schedule.service';
import { CreateApplyWindowDto, CreateFreezeDto, QueryScheduleStatusDto } from './dto/apply-schedule.dto';

@Controller('apply-schedule')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ApplyScheduleController {
  constructor(private readonly svc: ApplyScheduleService) {}

  @Get()
  list() { return this.svc.list(); }                 // 로그인 공통(관리 페이지·배너)

  @Get('status')
  status(@Query() q: QueryScheduleStatusDto) {       // 로그인 공통(CR 상세 배너)
    return this.svc.checkApplyAllowed(q.env);
  }

  @Post('windows')
  @Roles(Role.ADMIN)
  createWindow(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateApplyWindowDto) {
    return this.svc.createWindow(dto, this.actor(user));
  }

  @Delete('windows/:id')
  @Roles(Role.ADMIN)
  deleteWindow(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteWindow(id, this.actor(user));
  }

  @Post('freezes')
  @Roles(Role.ADMIN)
  createFreeze(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFreezeDto) {
    return this.svc.createFreeze(dto, this.actor(user));
  }

  @Delete('freezes/:id')
  @Roles(Role.ADMIN)
  deleteFreeze(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.svc.deleteFreeze(id, this.actor(user));
  }

  private actor(user: CurrentUserPayload) {
    return { userId: user.userId, name: user.name, role: user.role, department: user.department };
  }
}
