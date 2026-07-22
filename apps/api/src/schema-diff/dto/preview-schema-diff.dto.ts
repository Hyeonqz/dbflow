import { IsNotEmpty, IsString } from 'class-validator';

export class PreviewSchemaDiffDto {
  @IsString()
  @IsNotEmpty()
  targetDatabaseId!: string;

  @IsString()
  @IsNotEmpty()
  desiredSchemaSql!: string;
}
