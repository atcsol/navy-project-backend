import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateGmailAccountDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
