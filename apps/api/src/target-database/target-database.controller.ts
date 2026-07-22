import {
  Body,
  Controller,
  Delete,
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
import { CreateTargetDatabaseDto } from './dto/create-target-database.dto';
import { UpdateTargetDatabaseDto } from './dto/update-target-database.dto';
import { TargetDatabaseService } from './target-database.service';

/**
 * Target DB registry (contract §3). Reads are open to DEVELOPER (DEV-env
 * targets only) and APPROVER (all); the per-env scoping is enforced in the
 * service. Mutations and connection tests stay APPROVER-only (least privilege).
 * Responses are always sanitized — the encrypted credential never leaves the
 * service layer.
 */
@Controller('target-databases')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TargetDatabaseController {
  constructor(private readonly service: TargetDatabaseService) {}

  @Post()
  @Roles(Role.APPROVER)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTargetDatabaseDto) {
    return this.service.create(dto, user);
  }

  @Get()
  @Roles(Role.DEVELOPER, Role.APPROVER)
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.service.list(user);
  }

  @Get(':id')
  @Roles(Role.DEVELOPER, Role.APPROVER)
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.APPROVER)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTargetDatabaseDto,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.APPROVER)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.remove(id, user);
  }

  @Post(':id/test-connection')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.APPROVER)
  testConnection(@Param('id') id: string) {
    return this.service.testConnection(id);
  }
}
