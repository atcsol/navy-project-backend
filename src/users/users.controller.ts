import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { RolesService } from '../roles/roles.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
  ) {}

  @Post()
  @RequirePermission('users.create')
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @RequirePermission('users.view')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermission('users.view')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @RequirePermission('users.delete')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  // ===== Role Management Endpoints =====

  /**
   * Retorna o usuário com suas roles
   * GET /api/users/:id/roles
   */
  @Get(':id/roles')
  @RequirePermission('users.view')
  getUserRoles(@Param('id') id: string) {
    return this.rolesService.getUserWithRoles(id);
  }

  /**
   * Atribui roles a um usuário
   * POST /api/users/:id/roles
   */
  @Post(':id/roles')
  @RequirePermission('roles.update')
  assignRoles(
    @Param('id') id: string,
    @Body() assignRolesDto: AssignRolesDto,
  ) {
    return this.rolesService.assignRolesToUser(id, assignRolesDto.roles);
  }
}
