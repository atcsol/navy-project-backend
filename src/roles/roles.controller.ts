import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SyncPermissionsDto } from './dto/sync-permissions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Lista todas as roles
   * GET /api/roles
   */
  @Get()
  @RequirePermission('roles.view')
  findAll() {
    return this.rolesService.findAllRoles();
  }

  /**
   * Lista todas as permissões disponíveis
   * GET /api/roles/permissions
   */
  @Get('permissions')
  @RequirePermission('roles.view')
  findAllPermissions() {
    return this.permissionsService.findAll();
  }

  /**
   * Busca uma role específica
   * GET /api/roles/:id
   */
  @Get(':id')
  @RequirePermission('roles.view')
  findOne(@Param('id') id: string) {
    return this.rolesService.findRoleById(id);
  }

  /**
   * Cria uma nova role
   * POST /api/roles
   */
  @Post()
  @RequirePermission('roles.create')
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.createRole(createRoleDto);
  }

  /**
   * Atualiza uma role
   * PATCH /api/roles/:id
   */
  @Patch(':id')
  @RequirePermission('roles.update')
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.updateRole(id, updateRoleDto);
  }

  /**
   * Sincroniza permissões de uma role
   * POST /api/roles/:id/permissions
   */
  @Post(':id/permissions')
  @RequirePermission('roles.update')
  syncPermissions(
    @Param('id') id: string,
    @Body() dto: SyncPermissionsDto,
  ) {
    return this.rolesService.updateRole(id, { permissions: dto.permissions });
  }

  /**
   * Deleta uma role
   * DELETE /api/roles/:id
   */
  @Delete(':id')
  @RequirePermission('roles.delete')
  remove(@Param('id') id: string) {
    return this.rolesService.deleteRole(id);
  }
}
