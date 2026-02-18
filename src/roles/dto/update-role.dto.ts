import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[]; // nomes das permissões
}
