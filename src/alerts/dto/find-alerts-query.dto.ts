import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class FindAlertsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  unreadOnly?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
