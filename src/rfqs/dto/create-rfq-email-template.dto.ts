import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateRfqEmailTemplateDto {
  @IsString()
  name: string;

  @IsString()
  subject: string;

  @IsString()
  body: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateRfqEmailTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
