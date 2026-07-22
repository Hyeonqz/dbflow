import { IsNotEmpty, IsString } from 'class-validator';

export class DryRunDto {
  @IsString()
  @IsNotEmpty()
  targetDatabaseId!: string;
}
