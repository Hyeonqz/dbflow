import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ChangeRequestModule } from '../change-request/change-request.module';
import { TargetDatabaseModule } from '../target-database/target-database.module';
import { SchemaDiffController } from './schema-diff.controller';
import { SchemaDiffService } from './schema-diff.service';

@Module({
  imports: [PassportModule, TargetDatabaseModule, ChangeRequestModule],
  controllers: [SchemaDiffController],
  providers: [SchemaDiffService],
})
export class SchemaDiffModule {}
