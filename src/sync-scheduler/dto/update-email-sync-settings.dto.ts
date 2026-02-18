import { IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';

export class UpdateEmailSyncSettingsDto {
  @IsBoolean()
  @IsOptional()
  autoSyncEnabled?: boolean;

  @IsInt()
  @IsOptional()
  @Min(5)
  @Max(1440)
  syncIntervalMinutes?: number;
}
