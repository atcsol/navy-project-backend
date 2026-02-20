import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../roles/permissions.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  type?: 'access' | 'refresh';
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    permissions: string[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private permissionsService: PermissionsService,
  ) {}

  async register(createUserDto: CreateUserDto): Promise<AuthResponse> {
    const user = await this.usersService.create(createUserDto);

    const { accessToken, refreshToken } = await this.generateTokens(user.id, user.email);

    // Salva refresh token no banco
    await this.usersService.updateRefreshToken(user.id, refreshToken);

    // Carrega roles e permissions
    const [roles, permissions] = await Promise.all([
      this.permissionsService.getUserRoles(user.id),
      this.permissionsService.getUserPermissions(user.id),
    ]);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        permissions,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmailWithPassword(loginDto.email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user.id, user.email);

    // Salva refresh token no banco
    await this.usersService.updateRefreshToken(user.id, refreshToken);

    // Carrega roles e permissions
    const [roles, permissions] = await Promise.all([
      this.permissionsService.getUserRoles(user.id),
      this.permissionsService.getUserPermissions(user.id),
    ]);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        permissions,
      },
    };
  }

  async validateUser(userId: string) {
    return this.usersService.findOne(userId);
  }

  async generateTokens(userId: string, email: string) {
    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: userId,
      email,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '1h', // Access token expira em 1 hora
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || this.configService.get<string>('JWT_SECRET'),
      expiresIn: '7d', // Refresh token expira em 7 dias
    });

    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponse> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // Busca usuário e valida refresh token
      const user = await this.usersService.findOne(payload.sub);
      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Gera novos tokens
      const tokens = await this.generateTokens(user.id, user.email);

      // Atualiza refresh token no banco
      await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);

      // Carrega roles e permissions
      const [roles, permissions] = await Promise.all([
        this.permissionsService.getUserRoles(user.id),
        this.permissionsService.getUserPermissions(user.id),
      ]);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          permissions,
        },
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string) {
    // Remove refresh token do banco
    await this.usersService.updateRefreshToken(userId, null);
  }
}
