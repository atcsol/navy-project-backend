import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GmailService } from './gmail.service';
import { QueuesService } from '../queues/queues.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { FRONTEND_URL_DEFAULT } from '../common/constants/app.constants';
import { UpdateGmailAccountDto } from './dto/update-gmail-account.dto';
import { RawResponse } from '../common/interceptors/response.interceptor';

@Controller('gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly jwtService: JwtService,
    private readonly queuesService: QueuesService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inicia o fluxo OAuth2
   * GET /api/gmail/auth?token=JWT_TOKEN
   *
   * NOTA: Aceita token via query parameter porque window.location.href não envia headers
   */
  @Get('auth')
  @RawResponse()
  async initiateAuth(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        message: 'Authentication token is required',
      });
    }

    try {
      // Valida o token manualmente
      const payload = await this.jwtService.verifyAsync(token);

      if (!payload || !payload.sub) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: 'Invalid authentication token',
        });
      }

      const authUrl = this.gmailService.getAuthUrl(payload.sub);

      // Redireciona para a URL de autorização do Google
      return res.status(HttpStatus.FOUND).redirect(authUrl);
    } catch (error) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        message: 'Invalid or expired token',
      });
    }
  }

  /**
   * Callback do OAuth2 (Google redireciona para cá)
   * GET /api/gmail/oauth/callback?code=ABC123&state=userId
   */
  @Get('oauth/callback')
  @RawResponse()
  async handleCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        message: 'Authorization code not provided',
      });
    }

    if (!userId) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        message: 'User ID not provided in state',
      });
    }

    try {
      await this.gmailService.handleCallback(userId, code);

      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || FRONTEND_URL_DEFAULT;
      return res.redirect(`${frontendUrl}/settings?gmail=connected`);
    } catch (error) {
      this.logger.error('OAuth callback error:', error);
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || FRONTEND_URL_DEFAULT;
      return res.redirect(`${frontendUrl}/settings?gmail=error`);
    }
  }

  /**
   * Lista todas as contas Gmail do usuário
   * GET /api/gmail/accounts
   */
  @Get('accounts')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  findAll() {
    return this.gmailService.findAllByUser();
  }

  /**
   * Busca uma conta Gmail específica
   * GET /api/gmail/accounts/:id
   */
  @Get('accounts/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  findOne(@Param('id') id: string) {
    return this.gmailService.findOne(id);
  }

  /**
   * Atualiza uma conta Gmail (ex: ativar/desativar)
   * PATCH /api/gmail/accounts/:id
   */
  @Patch('accounts/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.create')
  update(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateGmailAccountDto,
  ) {
    return this.gmailService.update(id, dto);
  }

  /**
   * Desconecta uma conta Gmail
   * DELETE /api/gmail/accounts/:id/disconnect
   */
  @Delete('accounts/:id/disconnect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.delete')
  disconnect(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.gmailService.disconnect(id);
  }

  /**
   * Remove uma conta Gmail
   * DELETE /api/gmail/accounts/:id
   */
  @Delete('accounts/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.delete')
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.gmailService.remove(id);
  }

  /**
   * Inicia sincronização manual de emails
   * POST /api/gmail/accounts/:id/sync
   */
  @Post('accounts/:id/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.create')
  async syncEmails(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    const account = await this.gmailService.findOne(id);

    const jobId = await this.queuesService.addEmailSyncJob(
      user.id,
      account.id,
      account.lastSync || undefined,
    );

    return {
      message: 'Email sync job enqueued',
      jobId,
      gmailAccountId: account.id,
    };
  }

  /**
   * Consulta status de um job de sincronização
   * GET /api/gmail/sync-status/:jobId
   */
  @Get('sync-status/:jobId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  async getSyncStatus(@Param('jobId') jobId: string) {
    return this.queuesService.getSyncJobStatus(jobId);
  }

  /**
   * Lista emails de uma conta Gmail
   * GET /api/gmail/accounts/:accountId/emails?query=from:...&maxResults=20
   */
  @Get('accounts/:accountId/emails')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  listEmails(
    @Param('accountId') accountId: string,
    @CurrentUser() user: UserEntity,
    @Query('query') query?: string,
    @Query('maxResults') maxResults?: string,
  ) {
    return this.gmailService.listEmails(accountId, {
      query,
      maxResults: maxResults ? parseInt(maxResults, 10) : 20,
    });
  }

  /**
   * Obtém conteúdo de um email específico
   * GET /api/gmail/accounts/:accountId/emails/:messageId
   */
  @Get('accounts/:accountId/emails/:messageId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  getEmail(
    @Param('accountId') accountId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.gmailService.getEmailContent(accountId, messageId);
  }

  /**
   * Analisa um email e extrai campos automaticamente
   * GET /api/gmail/accounts/:accountId/emails/:messageId/analyze
   */
  @Get('accounts/:accountId/emails/:messageId/analyze')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('gmail.view')
  analyzeEmail(
    @Param('accountId') accountId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.gmailService.analyzeEmail(accountId, messageId);
  }
}
