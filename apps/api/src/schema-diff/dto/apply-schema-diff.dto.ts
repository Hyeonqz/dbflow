import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ApplySchemaDiffDto {
  @IsString()
  @IsNotEmpty()
  targetDatabaseId!: string;

  @IsString()
  @IsNotEmpty()
  desiredSchemaSql!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}
