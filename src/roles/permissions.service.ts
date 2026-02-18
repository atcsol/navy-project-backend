import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Retorna todas as permissões do sistema
   */
  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Retorna todas as roles de um usuário (nomes)
   */
  async getUserRoles(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return userRoles.map((ur) => ur.role.name);
  }

  /**
   * Retorna todas as permissões efetivas de um usuário (union de roles + diretas)
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    // Permissões via roles
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        role: {
          userRoles: {
            some: { userId },
          },
        },
      },
      include: { permission: true },
    });

    // Permissões diretas
    const directPermissions = await this.prisma.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });

    // Union (sem duplicatas)
    const permissionSet = new Set<string>();
    rolePermissions.forEach((rp) => permissionSet.add(rp.permission.name));
    directPermissions.forEach((dp) => permissionSet.add(dp.permission.name));

    return Array.from(permissionSet);
  }

  /**
   * Verifica se o usuário é super-admin
   */
  async isSuperAdmin(userId: string): Promise<boolean> {
    const roles = await this.getUserRoles(userId);
    return roles.includes('super-admin');
  }

  /**
   * Verifica se o usuário possui uma permissão específica
   */
  async userHasPermission(
    userId: string,
    permission: string,
  ): Promise<boolean> {
    // Super-admin tem todas as permissões
    if (await this.isSuperAdmin(userId)) {
      return true;
    }

    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }

  /**
   * Verifica se o usuário possui uma role específica
   */
  async userHasRole(userId: string, role: string): Promise<boolean> {
    const roles = await this.getUserRoles(userId);
    return roles.includes(role);
  }
}
