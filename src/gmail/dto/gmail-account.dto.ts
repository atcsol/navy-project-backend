import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ConnectGmailDto {
  @IsString()
  @IsNotEmpty()
  code: string; // OAuth code do Google
}

export class GmailAccountResponseDto {
  id: string;
  email: string;
  isActive: boolean;
  lastSync: Date | null;
  createdAt: Date;
}
