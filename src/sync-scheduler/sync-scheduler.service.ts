import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueuesService } from '../queues/queues.service';
import { UpdateEmailSyncSettingsDto } from './dto/update-email-sync-settings.dto';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesService: QueuesService,
  ) {}

  /**
   * Retorna configurações de auto-sync do usuário (upsert com defaults)
   */
  async getSettings(userId: string) {
    return this.prisma.emailSyncSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Atualiza configurações de auto-sync do usuário
   */
  async updateSettings(userId: string, dto: UpdateEmailSyncSettingsDto) {
    return this.prisma.emailSyncSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...dto,
      },
      update: dto,
    });
  }

  /**
   * Cron que roda a cada minuto para verificar quais usuários precisam de sync
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleAutoSync() {
    const settings = await this.prisma.emailSyncSettings.findMany({
      where: { autoSyncEnabled: true },
      include: {
        user: {
          include: {
            gmailAccounts: {
              where: { isActive: true },
            },
          },
        },
      },
    });

    for (const setting of settings) {
      const now = new Date();
      const lastSync = setting.lastAutoSync;
      const intervalMs = setting.syncIntervalMinutes * 60 * 1000;

      // Verifica se já passou o intervalo desde a última sync
      if (lastSync && now.getTime() - lastSync.getTime() < intervalMs) {
        continue;
      }

      const activeAccounts = setting.user.gmailAccounts;
      if (activeAccounts.length === 0) {
        continue;
      }

      this.logger.log(
        `Auto-sync triggered for user ${setting.userId} (${activeAccounts.length} accounts)`,
      );

      // Enfileira sync para cada conta Gmail ativa
      for (const account of activeAccounts) {
        try {
          await this.queuesService.addEmailSyncJob(
            setting.userId,
            account.id,
          );
        } catch (error) {
          this.logger.error(
            `Failed to enqueue auto-sync for account ${account.id}: ${error.message}`,
          );
        }
      }

      // Atualiza lastAutoSync
      await this.prisma.emailSyncSettings.update({
        where: { id: setting.id },
        data: { lastAutoSync: now },
      });
    }
  }
}
