import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  it('returns ok status', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: jest.fn() } }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
  });
});
