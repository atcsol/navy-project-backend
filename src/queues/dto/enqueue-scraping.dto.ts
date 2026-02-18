import { IsBoolean, IsOptional } from 'class-validator';

export class EnqueueScrapingDto {
  @IsBoolean()
  @IsOptional()
  rescrape?: boolean;
}
