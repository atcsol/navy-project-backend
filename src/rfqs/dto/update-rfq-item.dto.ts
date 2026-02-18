import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
} from 'class-validator';

export class UpdateRfqItemDto {
  @IsNumber()
  @IsOptional()
  quotedPrice?: number;

  @IsInt()
  @IsOptional()
  quotedDeliveryDays?: number;

  @IsString()
  @IsOptional()
  quotedCondition?: string;

  @IsString()
  @IsOptional()
  quotedNotes?: string;

  @IsBoolean()
  @IsOptional()
  isSelected?: boolean;
}
