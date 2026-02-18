import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class FindOpportunitiesQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  closingBefore?: string;

  @IsOptional()
  @IsString()
  closingAfter?: string;

  @IsOptional()
  @IsString()
  includeDeleted?: string;

  @IsOptional()
  @IsString()
  includeExpired?: string;

  @IsOptional()
  @IsString()
  quotationPhase?: string;

  @IsOptional()
  @IsString()
  purchaseStatus?: string;
}
