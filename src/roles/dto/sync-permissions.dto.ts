import { IsArray, IsString } from 'class-validator';

export class SyncPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions: string[]; // nomes das permissões
}
