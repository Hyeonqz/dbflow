import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { ChangeRequestController } from './change-request.controller';
import { ChangeRequestService } from './change-request.service';

/**
 * Boots the real controller so route declaration order is exercised for real
 * (unit tests call service.inbox() directly and can't catch a misordered
 * @Get(':id') swallowing 'inbox'). See task-1-brief Step 8.
 */
describe('ChangeRequestController (HTTP boot) — inbox route ordering', () => {
  let app: INestApplication;
  const serviceMock = { inbox: jest.fn().mockResolvedValue([]) };

  // 실제 JWT 검증 대신 고정 사용자를 주입한다 — 여기서는 라우팅 순서만 검증한다.
  class StubJwtGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
      context.switchToHttp().getRequest().user = {
        userId: 'u-rev',
        role: Role.REVIEWER,
        name: 'N',
        department: 'D',
      };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChangeRequestController],
      providers: [{ provide: ChangeRequestService, useValue: serviceMock }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useClass(StubJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /change-requests/inbox hits inbox(), not detail(:id)', async () => {
    await request(app.getHttpServer())
      .get('/change-requests/inbox')
      .expect(200)
      .expect((res) => expect(Array.isArray(res.body)).toBe(true));
    expect(serviceMock.inbox).toHaveBeenCalled();
  });
});
