import { PartialType } from '@nestjs/mapped-types';
import { CreateOpportunityDto } from './create-opportunity.dto';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsIn,
} from 'class-validator';
import {
  OpportunityStatus,
  QuotationPhase,
  PurchaseStatus,
} from '../../common/constants/opportunity.constants';

export class UpdateOpportunityDto extends PartialType(CreateOpportunityDto) {
  @IsNumber()
  @IsOptional()
  purchasePrice?: number;

  @IsNumber()
  @IsOptional()
  profitMargin?: number;

  @IsNumber()
  @IsOptional()
  wonPrice?: number;

  @IsIn(Object.values(OpportunityStatus))
  @IsOptional()
  status?: string;

  @IsBoolean()
  @IsOptional()
  isViewed?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class TransitionStatusDto {
  @IsIn(Object.values(OpportunityStatus))
  toStatus: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class UpdateQuotationPhaseDto {
  @IsIn(Object.values(QuotationPhase))
  phase: string;
}

export class UpdateBidDto {
  @IsNumber()
  @IsOptional()
  bidPrice?: number;

  @IsDateString()
  @IsOptional()
  bidSubmittedAt?: string;

  @IsString()
  @IsOptional()
  bidNotes?: string;
}

export class UpdateBidResultDto {
  @IsIn([OpportunityStatus.VENCEDORA_BID, OpportunityStatus.NAO_VENCEDORA])
  result: string;

  @IsDateString()
  @IsOptional()
  bidResultAt?: string;

  @IsNumber()
  @IsOptional()
  wonPrice?: number;

  @IsString()
  @IsOptional()
  bidNotes?: string;
}

export class UpdatePurchaseDto {
  @IsString()
  @IsOptional()
  supplierName?: string;

  @IsString()
  @IsOptional()
  supplierContact?: string;

  @IsString()
  @IsOptional()
  purchaseOrderNo?: string;

  @IsNumber()
  @IsOptional()
  purchasePrice?: number;

  @IsDateString()
  @IsOptional()
  purchaseDate?: string;

  @IsDateString()
  @IsOptional()
  expectedDelivery?: string;

  @IsIn(Object.values(PurchaseStatus))
  @IsOptional()
  purchaseStatus?: string;
}

export class UpdateDeliveryDto {
  @IsDateString()
  @IsOptional()
  actualDelivery?: string;

  @IsBoolean()
  @IsOptional()
  deliveryOnTime?: boolean;
}
