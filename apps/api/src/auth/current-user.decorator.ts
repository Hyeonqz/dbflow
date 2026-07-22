import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Shape populated by `JwtStrategy.validate()` onto `request.user`.
 */
export interface CurrentUserPayload {
  userId: string;
  role: Role;
  name: string;
  department: string;
}

/**
 * Extracts the authenticated user (`request.user`) populated by `AuthGuard('jwt')`.
 * MUST be used on routes guarded by a JWT guard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);
