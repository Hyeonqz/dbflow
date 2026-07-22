import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { QueryAdminUsersDto } from './dto/query-admin-users.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @Roles(Role.ADMIN)
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateUserDto) {
    const u = await this.users.create(dto, user);
    return { id: u.id, email: u.email, name: u.name, department: u.department, role: u.role };
  }

  @Get()
  list(@Query('role') role?: Role) {
    return role ? this.users.listByRole(role) : [];
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  adminList(@Query() q: QueryAdminUsersDto) {
    return this.users.adminList(q);
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.users.profile(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.userId, dto, user);
  }
}
