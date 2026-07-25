import {
  ArgumentsHost, Catch,
  ForbiddenException, HttpException, UnauthorizedException,
} from '@nestjs/common';
import type { HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { AuditAction, AuditOutcome, AuditTargetType } from '@prisma/client';
import { AuditService } from './audit.service';
import { resolveLocale } from '../i18n/locale';
import { translate } from '../i18n/messages';

@Catch()
export class AuditExceptionFilter extends BaseExceptionFilter {
  constructor(
    private readonly audit: AuditService,
    applicationRef?: HttpServer,
  ) {
    super(applicationRef);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest();
    const ip = req?.ip ?? null;
    const userAgent = req?.headers?.['user-agent'] ?? null;

    if (exception instanceof UnauthorizedException && String(req?.url).includes('/auth/login')) {
      void this.audit.record({
        action: AuditAction.LOGIN_FAILURE, targetType: AuditTargetType.AUTH, outcome: AuditOutcome.FAILURE,
        summary: '로그인 실패', metadata: { email: req?.body?.email ?? null }, ip, userAgent,
      });
    } else if (exception instanceof ForbiddenException) {
      const user = req?.user;
      void this.audit.record({
        action: AuditAction.ACCESS_DENIED, targetType: AuditTargetType.AUTH, outcome: AuditOutcome.FAILURE,
        summary: `권한 거부: ${req?.method} ${req?.url}`,
        actor: user ? { userId: user.userId, name: user.name, role: user.role, department: user.department } : null,
        metadata: { method: req?.method, path: req?.url }, ip, userAgent,
      });
    }

    // i18n: {key,args} 페이로드를 요청 로케일로 번역해 표준 메시지로 재구성
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (res && typeof res === 'object' && 'key' in (res as Record<string, unknown>)) {
        const { key, args } = res as { key: string; args?: Record<string, string | number> };
        const locale = resolveLocale(req?.headers?.['accept-language']);
        const translated = new HttpException(translate(key, locale, args), exception.getStatus());
        return super.catch(translated, host);
      }
    }

    super.catch(exception, host); // 감사 기록 후 기본 필터에 위임 — 모든 경로에서 정상 HTTP 응답을 만든다.
  }
}
