import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChangeRequestModule } from './change-request/change-request.module';
import { TargetDatabaseModule } from './target-database/target-database.module';
import { ApplyModule } from './apply/apply.module';
import { SchemaDiffModule } from './schema-diff/schema-diff.module';
import { SqlReviewModule } from './sql-review/sql-review.module';
import { ApprovalPolicyModule } from './approval-policy/approval-policy.module';
import { ApplyScheduleModule } from './apply-schedule/apply-schedule.module';
import { DelegationModule } from './delegation/delegation.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    UsersModule,
    ChangeRequestModule,
    TargetDatabaseModule,
    ApplyModule,
    SchemaDiffModule,
    SqlReviewModule,
    ApprovalPolicyModule,
    ApplyScheduleModule,
    DelegationModule,
    BootstrapModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
