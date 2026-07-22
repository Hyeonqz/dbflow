import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ChangeRequestService } from './change-request.service';
import { AssigneesDto } from './dto/assignees.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { DecisionDto } from './dto/decision.dto';

@Controller('change-requests')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ChangeRequestController {
  constructor(private readonly service: ChangeRequestService) {}

  @Post()
  @Roles(Role.DEVELOPER)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateChangeRequestDto) {
    return this.service.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.service.list(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DEVELOPER)
  submit(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.submit(user, id);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.REVIEWER)
  review(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.service.review(user, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.APPROVER)
  approve(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.service.approve(user, id, dto);
  }

  @Patch(':id/assignees')
  setAssignees(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AssigneesDto,
  ) {
    return this.service.setAssignees(user, id, dto);
  }
}
