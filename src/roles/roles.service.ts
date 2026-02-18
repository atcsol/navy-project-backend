import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async findAllRoles() {
    return this.prisma.role.findMany({
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        _count: { select: { userRoles: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRoleById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        _count: { select: { userRoles: true } },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists`);
    }

    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        guardName: dto.guardName || 'api',
      },
    });

    // Sincronizar permissões se fornecidas
    if (dto.permissions && dto.permissions.length > 0) {
      await this.syncRolePermissions(role.id, dto.permissions);
    }

    return this.findRoleById(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.findRoleById(id);

    // Super-admin não pode ser modificado
    if (role.name === 'super-admin') {
      throw new ForbiddenException('Cannot modify super-admin role');
    }

    if (dto.name && dto.name !== role.name) {
      const existing = await this.prisma.role.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Role "${dto.name}" already exists`);
      }
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
      },
    });

    if (dto.permissions) {
      await this.syncRolePermissions(id, dto.permissions);
    }

    return this.findRoleById(id);
  }

  async deleteRole(id: string) {
    const role = await this.findRoleById(id);

    if (role.isSystem) {
      throw new ForbiddenException('Cannot delete system role');
    }

    await this.prisma.role.delete({ where: { id } });
    return { message: `Role "${role.name}" deleted` };
  }

  async syncRolePermissions(roleId: string, permissionNames: string[]) {
    // Busca IDs das permissões
    const permissions = await this.prisma.permission.findMany({
      where: { name: { in: permissionNames } },
    });

    // Remove todas as permissões atuais
    await this.prisma.rolePermission.deleteMany({
      where: { roleId },
    });

    // Adiciona novas permissões
    if (permissions.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId,
          permissionId: p.id,
        })),
      });
    }
  }

  // ===== User Role Management =====

  async assignRolesToUser(userId: string, roleNames: string[]) {
    // Verifica se o usuário existe
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Busca roles
    const roles = await this.prisma.role.findMany({
      where: { name: { in: roleNames } },
    });

    // Remove roles atuais
    await this.prisma.userRole.deleteMany({
      where: { userId },
    });

    // Adiciona novos roles
    if (roles.length > 0) {
      await this.prisma.userRole.createMany({
        data: roles.map((r) => ({
          userId,
          roleId: r.id,
        })),
        skipDuplicates: true,
      });
    }

    return this.getUserWithRoles(userId);
  }

  async getUserWithRoles(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
        userPermissions: {
          include: { permission: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.userRoles.map((ur) => ur.role.name),
      directPermissions: user.userPermissions.map((up) => up.permission.name),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async findAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
