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
   * Cron que roda a cada 30 minutos para sincronizar TODAS as contas Gmail ativas.
   * Não depende de configuração por usuário — é global.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleAutoSync() {
    const activeAccounts = await this.prisma.gmailAccount.findMany({
      where: { isActive: true },
    });

    if (activeAccounts.length === 0) {
      return;
    }

    this.logger.log(
      `Auto-sync triggered for ${activeAccounts.length} active Gmail account(s)`,
    );

    for (const account of activeAccounts) {
      try {
        await this.queuesService.addEmailSyncJob(
          account.userId,
          account.id,
          account.lastSync || undefined,
        );
      } catch (error) {
        this.logger.error(
          `Failed to enqueue auto-sync for account ${account.email}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Reconciliação de scraping a cada 10 minutos: re-enfileira automaticamente
   * oportunidades pendentes/órfãs que ainda não foram scrapeadas (ex: após o
   * circuit breaker do NECO, restart do Redis ou falha ao enfileirar na criação).
   * Garante que o scraping volte sozinho — sem precisar clicar para iniciar.
   * Não faz nada se a fila estiver pausada (cooldown ativo).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleScrapingReconciliation() {
    try {
      const { enqueued, skipped } = await this.queuesService.reconcilePendingScraping();
      if (enqueued > 0) {
        this.logger.log(`Scraping reconciliation: ${enqueued} job(s) re-enfileirado(s)`);
      } else if (skipped) {
        this.logger.debug(`Scraping reconciliation pulada: ${skipped}`);
      }
    } catch (error) {
      this.logger.error(
        `Scraping reconciliation failed: ${(error as Error).message}`,
      );
    }
  }
}
