import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  guardName?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[]; // nomes das permissões
}
