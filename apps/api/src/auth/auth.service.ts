import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { verifyPassword } from './password.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async validateAndLogin(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    const accessToken = this.jwt.sign({ sub: user.id, role: user.role });
    await this.audit.record({
      actor: { userId: user.id, name: user.name, role: user.role, department: user.department },
      action: AuditAction.LOGIN_SUCCESS,
      targetType: AuditTargetType.AUTH,
      targetId: user.id,
      summary: `로그인: ${user.email}`,
    });
    return {
      accessToken,
      user: {
        id: user.id, email: user.email, name: user.name,
        department: user.department, role: user.role,
      },
    };
  }
}
