import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    // Verificar se email já existe
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Hash da senha se fornecida
    let passwordHash: string | null = null;
    if (createUserDto.password) {
      passwordHash = await bcrypt.hash(createUserDto.password, 10);
    }

    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        name: createUserDto.name,
        passwordHash,
      },
    });

    return new UserEntity(user);
  }

  async findAll(): Promise<UserEntity[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => new UserEntity(user));
  }

  async findOne(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return new UserEntity(user);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return user ? new UserEntity(user) : null;
  }

  /**
   * Retorna o usuário com senha (para autenticação)
   * NÃO usar em endpoints públicos!
   */
  async findByEmailWithPassword(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserEntity> {
    // Verificar se usuário existe
    await this.findOne(id);

    // Hash da senha se fornecida
    const updateData: { email?: string; name?: string; passwordHash?: string } = {};

    if (updateUserDto.email) {
      updateData.email = updateUserDto.email;
    }

    if (updateUserDto.name) {
      updateData.name = updateUserDto.name;
    }

    if (updateUserDto.password) {
      updateData.passwordHash = await bcrypt.hash(updateUserDto.password, 10);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    return new UserEntity(user);
  }

  async remove(id: string): Promise<void> {
    // Verificar se usuário existe
    await this.findOne(id);

    await this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Valida senha do usuário
   */
  async validatePassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      return false;
    }

    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Atualiza o refresh token do usuário
   */
  async updateRefreshToken(userId: string, refreshToken: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken },
    });
  }
}
