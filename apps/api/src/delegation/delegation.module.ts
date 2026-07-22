import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

@Module({
  imports: [PassportModule],
  controllers: [DelegationController],
  providers: [DelegationService, PrismaService],
  exports: [DelegationService],
})
export class DelegationModule {}
