import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { TargetDatabaseController } from './target-database.controller';
import { TargetDatabaseService } from './target-database.service';

@Module({
  imports: [PassportModule],
  controllers: [TargetDatabaseController],
  providers: [TargetDatabaseService, PrismaService],
  exports: [TargetDatabaseService],
})
export class TargetDatabaseModule {}
