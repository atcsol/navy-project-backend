import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SyncSchedulerService } from './sync-scheduler.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { UpdateEmailSyncSettingsDto } from './dto/update-email-sync-settings.dto';

@Controller('email-sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SyncSchedulerController {
  constructor(
    private readonly syncSchedulerService: SyncSchedulerService,
  ) {}

  /**
   * Retorna configurações de auto-sync do usuário
   * GET /api/email-sync/settings
   */
  @Get('settings')
  @RequirePermission('gmail.view')
  getSettings(@CurrentUser() user: UserEntity) {
    return this.syncSchedulerService.getSettings(user.id);
  }

  /**
   * Atualiza configurações de auto-sync do usuário
   * PUT /api/email-sync/settings
   */
  @Put('settings')
  @RequirePermission('gmail.create')
  updateSettings(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateEmailSyncSettingsDto,
  ) {
    return this.syncSchedulerService.updateSettings(user.id, dto);
  }
}
