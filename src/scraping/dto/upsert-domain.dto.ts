import {
  IsBoolean,
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
} from 'class-validator';

export class UpsertDomainDto {
  @IsString()
  @IsNotEmpty()
  domain: string;

  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  @IsOptional()
  requiresAuth?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @IsOptional()
  timeoutMs?: number;
}
