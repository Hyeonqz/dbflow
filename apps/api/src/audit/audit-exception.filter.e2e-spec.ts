import { Body, Controller, ForbiddenException, Get, Post, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditExceptionFilter } from './audit-exception.filter';
import { AuditService } from './audit.service';

// 검증용 DTO — 빈 요청이면 ValidationPipe가 BadRequestException을 던진다.
class LoginDto {
  @IsString() password!: string;
}

// 실제 컨트롤러 대신 세 가지 예외 경로만 재현하는 최소 컨트롤러.
@Controller()
class ProbeController {
  @Post('auth/login')
  login() {
    throw new UnauthorizedException('bad credentials');
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException('no access');
  }

  @Post('validate')
  validate(@Body() _dto: LoginDto) {
    return { ok: true };
  }
}

/**
 * HTTP-boot regression test: AuditExceptionFilter는 과거 예외를 재-throw해서
 * 모든 에러 경로에서 서버가 크래시했다. BaseExceptionFilter.catch로 위임하도록
 * 고친 뒤에도 동일 회귀가 재발하지 않는지, 실제로 HTTP 서버를 띄워 확인한다.
 * (유닛 테스트는 host를 목으로 만들어 호출하므로 이 크래시를 잡지 못했다.)
 */
describe('AuditExceptionFilter (HTTP boot)', () => {
  let app: INestApplication;
  const auditMock = { record: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: AuditService, useValue: auditMock }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(
      new AuditExceptionFilter(auditMock as unknown as AuditService, app.get(HttpAdapterHost).httpAdapter),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    auditMock.record.mockClear();
  });

  it('responds 401 (not a crash/hang) and records LOGIN_FAILURE for /auth/login', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(401);
    expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_FAILURE' }));
  });

  it('responds 403 (not a crash/hang) and records ACCESS_DENIED for a forbidden route', async () => {
    await request(app.getHttpServer()).get('/forbidden').expect(403);
    expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCESS_DENIED' }));
  });

  it('responds 400 (not a crash/hang) for a validation failure without auditing it', async () => {
    await request(app.getHttpServer()).post('/validate').send({}).expect(400);
    expect(auditMock.record).not.toHaveBeenCalled();
  });
});
