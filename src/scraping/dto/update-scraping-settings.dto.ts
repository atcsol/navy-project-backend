import { IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';

export class UpdateScrapingSettingsDto {
  @IsInt()
  @IsOptional()
  @Min(1000)
  @Max(60000)
  minDelayMs?: number;

  @IsInt()
  @IsOptional()
  @Min(1000)
  @Max(60000)
  maxDelayMs?: number;

  @IsInt()
  @IsOptional()
  @Min(5000)
  @Max(120000)
  globalTimeoutMs?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(10)
  maxRetries?: number;

  @IsInt()
  @IsOptional()
  @Min(500)
  @Max(30000)
  retryDelayMs?: number;

  @IsBoolean()
  @IsOptional()
  autoScrapeOnSync?: boolean;
}
