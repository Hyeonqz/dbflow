import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { AuditAction, AuditTargetType, Prisma, Role, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuditActorSnapshot } from '../audit/audit.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(input: {
    email: string; name: string; department: string; password: string; role: Role;
  }, actor: AuditActorSnapshot): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    const created = await this.prisma.user.create({
      data: {
        email: input.email, name: input.name, department: input.department,
        role: input.role, passwordHash,
      },
    });
    await this.audit.record({
      actor,
      action: AuditAction.USER_CREATED,
      targetType: AuditTargetType.USER,
      targetId: created.id,
      summary: `계정 생성: ${created.email}`,
      metadata: { role: created.role, department: created.department },
    });
    return created;
  }

  listByRole(role: Role) {
    return this.prisma.user.findMany({
      where: { role },
      select: { id: true, name: true, department: true },
      orderBy: { name: 'asc' },
    });
  }

  async adminList(q: { page?: number; role?: Role; q?: string }) {
    const pageSize = 20;
    const page = q.page && q.page > 0 ? q.page : 1;
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { email: { contains: q.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, department: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async profile(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return {
      id: u.id, email: u.email, name: u.name, department: u.department,
      role: u.role, telegramLinked: !!u.telegramChatId,
    };
  }

  async updateMe(
    id: string,
    data: { name?: string; department?: string; telegramChatId?: string },
    actor: AuditActorSnapshot,
  ) {
    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.audit.record({
      actor,
      action: AuditAction.USER_PROFILE_UPDATED,
      targetType: AuditTargetType.USER,
      targetId: id,
      summary: '프로필 수정',
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }
}
