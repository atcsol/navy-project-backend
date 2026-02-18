import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsObject,
} from 'class-validator';

export class CreateRfqDto {
  @IsString()
  gmailAccountId: string;

  @IsString()
  @IsOptional()
  opportunityId?: string;

  @IsString()
  title: string;

  @IsString()
  emailSubject: string;

  @IsString()
  emailBody: string;

  @IsArray()
  @IsString({ each: true })
  supplierIds: string[];

  @IsObject()
  @IsOptional()
  opportunityData?: Record<string, unknown>;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
