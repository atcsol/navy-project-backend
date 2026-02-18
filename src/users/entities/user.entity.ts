import { User as PrismaUser } from '@prisma/client';
import { Exclude } from 'class-transformer';

export class UserEntity implements PrismaUser {
  id: string;
  email: string;
  name: string;

  @Exclude() // Nunca expor o hash da senha
  passwordHash: string | null;

  @Exclude() // Nunca expor o refresh token
  refreshToken: string | null;

  createdAt: Date;
  updatedAt: Date;

  // RBAC - populados dinamicamente
  roles?: string[];
  permissions?: string[];

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
