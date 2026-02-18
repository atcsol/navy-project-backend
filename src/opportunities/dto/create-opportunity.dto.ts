import {
  IsString,
  IsOptional,
  IsDateString,
  IsNumber,
  IsObject,
  IsBoolean,
} from 'class-validator';

export class CreateOpportunityDto {
  // Identificação do Email
  @IsString()
  emailMessageId: string;

  @IsString()
  @IsOptional()
  emailThreadId?: string;

  @IsDateString()
  emailDate: string;

  @IsString()
  fingerprint: string;

  @IsString()
  templateId: string;

  @IsString()
  gmailAccountId: string;

  // Campos Extraídos (opcionais)
  @IsString()
  @IsOptional()
  solicitationNumber?: string;

  @IsString()
  @IsOptional()
  site?: string;

  @IsString()
  @IsOptional()
  sourceUrl?: string;

  @IsString()
  @IsOptional()
  partNumber?: string;

  @IsString()
  @IsOptional()
  manufacturer?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  nsn?: string;

  @IsString()
  @IsOptional()
  condition?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  // Datas
  @IsDateString()
  @IsOptional()
  closingDate?: string;

  @IsDateString()
  @IsOptional()
  deliveryDate?: string;

  // Dados brutos (JSON)
  @IsObject()
  extractedData: Record<string, unknown>;
}
