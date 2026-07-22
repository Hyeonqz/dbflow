import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalPolicyService } from './approval-policy.service';

@Module({
  imports: [PassportModule],
  controllers: [ApprovalPolicyController],
  providers: [ApprovalPolicyService, PrismaService],
  exports: [ApprovalPolicyService],
})
export class ApprovalPolicyModule {}
