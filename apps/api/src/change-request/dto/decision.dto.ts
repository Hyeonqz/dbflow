import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum Decision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class DecisionDto {
  @IsEnum(Decision)
  decision!: Decision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
