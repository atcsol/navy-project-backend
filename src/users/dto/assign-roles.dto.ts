import { IsArray, IsString } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @IsString({ each: true })
  roles: string[]; // nomes das roles
}
