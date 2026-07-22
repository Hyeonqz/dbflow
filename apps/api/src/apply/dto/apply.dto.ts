import { IsNotEmpty, IsString } from 'class-validator';

export class ApplyDto {
  @IsString()
  @IsNotEmpty()
  targetDatabaseId!: string;
}
