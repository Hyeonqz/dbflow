import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyController } from './apply.controller';
import { RollbackController } from './rollback.controller';
import { ApplyService } from './apply.service';
import { DryRunService } from './dry-run.service';
import { BackupService } from './backup.service';
import { RollbackService } from './rollback.service';
import { SqlReviewModule } from '../sql-review/sql-review.module';
import { ApplyScheduleModule } from '../apply-schedule/apply-schedule.module';

@Module({
  imports: [PassportModule, SqlReviewModule, ApplyScheduleModule],
  controllers: [ApplyController, RollbackController],
  providers: [ApplyService, DryRunService, BackupService, RollbackService, PrismaService],
})
export class ApplyModule {}
