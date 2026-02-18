import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { FindAlertsQueryDto } from './dto/find-alerts-query.dto';

@Controller('alerts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * Contagem de alertas não lidos
   * GET /api/alerts/unread-count
   */
  @Get('unread-count')
  @RequirePermission('alerts.view')
  unreadCount(@CurrentUser() user: UserEntity) {
    return this.alertsService.unreadCount(user.id);
  }

  /**
   * Lista alertas do usuário
   * GET /api/alerts?page=1&limit=20&unreadOnly=true&type=cancellation
   */
  @Get()
  @RequirePermission('alerts.view')
  findAll(
    @CurrentUser() user: UserEntity,
    @Query() query: FindAlertsQueryDto,
  ) {
    return this.alertsService.findAll(user.id, query.page, query.limit, {
      unreadOnly: query.unreadOnly === 'true',
      type: query.type,
    });
  }

  /**
   * Marcar alerta como lido
   * PATCH /api/alerts/:id/read
   */
  @Patch(':id/read')
  @RequirePermission('alerts.view')
  markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.alertsService.markAsRead(id, user.id);
  }

  /**
   * Marcar todos alertas como lidos
   * POST /api/alerts/mark-all-read
   */
  @Post('mark-all-read')
  @RequirePermission('alerts.view')
  markAllAsRead(@CurrentUser() user: UserEntity) {
    return this.alertsService.markAllAsRead(user.id);
  }
}
