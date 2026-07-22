import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalPolicyModule } from '../approval-policy/approval-policy.module';
import { DelegationModule } from '../delegation/delegation.module';
import { ChangeRequestController } from './change-request.controller';
import { ChangeRequestService } from './change-request.service';

@Module({
  imports: [PassportModule, ApprovalPolicyModule, DelegationModule],
  controllers: [ChangeRequestController],
  providers: [ChangeRequestService, PrismaService],
  exports: [ChangeRequestService],
})
export class ChangeRequestModule {}
