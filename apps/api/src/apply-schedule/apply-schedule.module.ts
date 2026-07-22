import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyScheduleController } from './apply-schedule.controller';
import { ApplyScheduleService } from './apply-schedule.service';

@Module({
  imports: [PassportModule],
  controllers: [ApplyScheduleController],
  providers: [ApplyScheduleService, PrismaService],
  exports: [ApplyScheduleService],
})
export class ApplyScheduleModule {}
