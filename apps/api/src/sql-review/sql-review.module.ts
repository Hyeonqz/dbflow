import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { SqlReviewController } from './sql-review.controller';
import { SqlReviewService } from './sql-review.service';

@Module({
  imports: [PassportModule],
  controllers: [SqlReviewController],
  providers: [SqlReviewService, PrismaService],
  exports: [SqlReviewService],
})
export class SqlReviewModule {}
