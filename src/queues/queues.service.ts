import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job } from 'bull';
import { ScrapingJob } from './processors/scraping.processor';
import { PrismaService } from '../prisma/prisma.service';
import { ScrapingStatus } from '../common/constants/opportunity.constants';

export interface EmailSyncJob {
  userId: string;
  gmailAccountId: string;
  templateId?: string;
  since?: Date;
}

export interface OpportunityProcessingJob {
  userId: string;
  gmailAccountId: string;
  emailMessageId: string;
  emailThreadId: string;
  emailDate: Date;
  emailBody: string;
  templateId?: string;
}

export interface SyncProgress {
  emailsFound?: number;
  emailsProcessed?: number;
  opportunityJobIds?: string[];
  [key: string]: unknown;
}

export interface SyncJobStatus {
  jobId: string;
  state: string;
  progress: SyncProgress | null;
  result: Record<string, unknown> | null;
  failedReason: string | null;
  opportunityJobs: OpportunityJobSummary[];
}

export interface OpportunityJobSummary {
  jobId: string;
  state: string;
  result: Record<string, unknown> | null;
}

@Injectable()
export class QueuesService {
  private readonly logger = new Logger(QueuesService.name);

  constructor(
    @InjectQueue('email-sync')
    private emailSyncQueue: Queue<EmailSyncJob>,
    @InjectQueue('opportunity-processing')
    private opportunityProcessingQueue: Queue<OpportunityProcessingJob>,
    @InjectQueue('scraping')
    private scrapingQueue: Queue<ScrapingJob>,
    private prisma: PrismaService,
  ) {}

  async addEmailSyncJob(
    userId: string,
    gmailAccountId: string,
    since?: Date,
    templateId?: string,
  ): Promise<string> {
    const job = await this.emailSyncQueue.add(
      'sync-emails',
      { userId, gmailAccountId, since, templateId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(
      `Email sync job ${job.id} added for user ${userId}, account ${gmailAccountId}`,
    );

    return String(job.id);
  }

  async addOpportunityProcessingJob(
    data: OpportunityProcessingJob,
  ): Promise<string> {
    const job = await this.opportunityProcessingQueue.add(
      'process-opportunity',
      data,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.logger.debug(
      `Opportunity processing job ${job.id} added for email ${data.emailMessageId}`,
    );

    return String(job.id);
  }

  /**
   * Adiciona job de scraping à fila
   */
  async addScrapingJob(data: ScrapingJob, delayMs?: number): Promise<string> {
    const job = await this.scrapingQueue.add(
      'scrape-opportunity',
      data,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        ...(delayMs ? { delay: delayMs } : {}),
      },
    );

    this.logger.log(
      `Scraping job ${job.id} added for opportunity ${data.opportunityId}, URL: ${data.sourceUrl}`,
    );

    return String(job.id);
  }

  async getSyncJobStatus(jobId: string): Promise<SyncJobStatus> {
    const job = await this.emailSyncQueue.getJob(jobId);

    if (!job) {
      return {
        jobId,
        state: 'not_found',
        progress: null,
        result: null,
        failedReason: null,
        opportunityJobs: [],
      };
    }

    const [state, progress] = await Promise.all([
      job.getState(),
      Promise.resolve(job.progress()),
    ]);

    const opportunityJobs = await this.getOpportunityJobsForSync(progress);

    return {
      jobId,
      state,
      progress,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? (job.failedReason ?? null) : null,
      opportunityJobs,
    };
  }

  private async getOpportunityJobsForSync(
    syncProgress: SyncProgress | null,
  ): Promise<OpportunityJobSummary[]> {
    const oppJobIds: string[] = syncProgress?.opportunityJobIds || [];
    if (oppJobIds.length === 0) return [];

    const summaries = await Promise.all(
      oppJobIds.map(async (id) => {
        const oppJob = await this.opportunityProcessingQueue.getJob(id);
        if (!oppJob) {
          return { jobId: id, state: 'not_found', result: null };
        }
        const oppState = await oppJob.getState();
        return {
          jobId: id,
          state: oppState,
          result: oppState === 'completed' ? oppJob.returnvalue : null,
        };
      }),
    );

    return summaries;
  }

  async getQueueStats() {
    const [emailSyncCounts, opportunityProcessingCounts, scrapingCounts] =
      await Promise.all([
        this.emailSyncQueue.getJobCounts(),
        this.opportunityProcessingQueue.getJobCounts(),
        this.scrapingQueue.getJobCounts(),
      ]);

    return {
      emailSync: emailSyncCounts,
      opportunityProcessing: opportunityProcessingCounts,
      scraping: scrapingCounts,
    };
  }

  /**
   * Obtém logs recentes de todas as filas
   */
  async getRecentLogs(limit: number = 50) {
    const [emailSyncJobs, opportunityJobs, scrapingJobs] = await Promise.all([
      this.getRecentJobsFromQueue(this.emailSyncQueue, 'email-sync', limit),
      this.getRecentJobsFromQueue(this.opportunityProcessingQueue, 'opportunity-processing', limit),
      this.getRecentJobsFromQueue(this.scrapingQueue, 'scraping', limit),
    ]);

    // Combina e ordena por timestamp
    const allLogs = [...emailSyncJobs, ...opportunityJobs, ...scrapingJobs]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return allLogs;
  }

  private async getRecentJobsFromQueue(
    queue: Queue,
    queueName: string,
    limit: number,
  ) {
    const [completed, failed, active, waiting] = await Promise.all([
      queue.getCompleted(0, Math.floor(limit / 2)),
      queue.getFailed(0, Math.floor(limit / 4)),
      queue.getActive(0, 10),
      queue.getWaiting(0, 10),
    ]);

    const mapJob = (job: Job, state: string) => ({
      id: String(job.id),
      queue: queueName,
      state,
      data: {
        // Campos seguros para exibir (sem dados sensíveis)
        userId: job.data.userId,
        emailMessageId: job.data.emailMessageId,
        opportunityId: job.data.opportunityId,
        sourceUrl: job.data.sourceUrl,
        templateId: job.data.templateId,
      },
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      attemptsMade: job.attemptsMade,
    });

    return [
      ...completed.map((j) => mapJob(j, 'completed')),
      ...failed.map((j) => mapJob(j, 'failed')),
      ...active.map((j) => mapJob(j, 'active')),
      ...waiting.map((j) => mapJob(j, 'waiting')),
    ];
  }

  async cleanOldJobs(): Promise<void> {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    await Promise.all([
      this.emailSyncQueue.clean(sevenDaysAgo, 'completed'),
      this.emailSyncQueue.clean(sevenDaysAgo, 'failed'),
      this.opportunityProcessingQueue.clean(sevenDaysAgo, 'completed'),
      this.opportunityProcessingQueue.clean(sevenDaysAgo, 'failed'),
      this.scrapingQueue.clean(sevenDaysAgo, 'completed'),
      this.scrapingQueue.clean(sevenDaysAgo, 'failed'),
    ]);

    this.logger.log('Cleaned old jobs from queues');
  }

  /**
   * Enfileira oportunidades pendentes para scraping via Bull queue
   * Opção rescrape=true re-enfileira mesmo as que já foram processadas
   */
  async bulkEnqueueScraping(
    userId: string,
    options: { rescrape?: boolean } = {},
  ): Promise<{ enqueued: number; totalPending: number; skippedExpired: number }> {
    const statusFilter = options.rescrape
      ? [ScrapingStatus.PENDING, ScrapingStatus.FAILED, ScrapingStatus.SUCCESS]
      : [ScrapingStatus.PENDING, ScrapingStatus.FAILED];

    // Início do dia de hoje (oportunidades de hoje ainda são válidas)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const opportunities = await this.prisma.opportunity.findMany({
      where: {
        userId,
        sourceUrl: { not: null },
        deletedAt: null,
        status: { not: 'cancelada' },
        AND: [
          { OR: [{ scrapingStatus: { in: statusFilter } }, { scrapingStatus: null }] },
          { OR: [{ closingDate: { gte: today } }, { closingDate: null }] },
        ],
      },
      select: {
        id: true,
        sourceUrl: true,
        templateId: true,
      },
    });

    // Conta quantas foram puladas por data vencida
    const totalWithExpired = await this.prisma.opportunity.count({
      where: {
        userId,
        sourceUrl: { not: null },
        deletedAt: null,
        OR: [{ scrapingStatus: { in: statusFilter } }, { scrapingStatus: null }],
      },
    });
    const skippedExpired = totalWithExpired - opportunities.length;

    // Rescrape: resetar status para 'pending' no banco para que o progresso funcione
    if (options.rescrape && opportunities.length > 0) {
      const ids = opportunities.filter(o => o.sourceUrl && o.templateId).map(o => o.id);
      await this.prisma.opportunity.updateMany({
        where: { id: { in: ids } },
        data: { scrapingStatus: ScrapingStatus.PENDING },
      });
    }

    let enqueued = 0;
    for (const opp of opportunities) {
      if (!opp.sourceUrl || !opp.templateId) continue;

      await this.addScrapingJob({
        opportunityId: opp.id,
        userId,
        templateId: opp.templateId,
        sourceUrl: opp.sourceUrl,
      });
      enqueued++;
    }

    const totalPending = await this.prisma.opportunity.count({
      where: {
        userId,
        scrapingStatus: { in: [ScrapingStatus.PENDING, ScrapingStatus.FAILED] },
        sourceUrl: { not: null },
        deletedAt: null,
        status: { not: 'cancelada' },
        OR: [
          { closingDate: { gte: today } },
          { closingDate: null },
        ],
      },
    });

    // Marca expiradas como EXPIRED no scraping_status
    if (skippedExpired > 0) {
      await this.prisma.opportunity.updateMany({
        where: {
          userId,
          sourceUrl: { not: null },
          deletedAt: null,
          closingDate: { lt: today },
          scrapingStatus: null,
        },
        data: { scrapingStatus: ScrapingStatus.EXPIRED },
      });
    }

    this.logger.log(
      `Bulk enqueued ${enqueued} scraping jobs for user ${userId} (rescrape=${!!options.rescrape}, skippedExpired=${skippedExpired})`,
    );

    return { enqueued, totalPending, skippedExpired };
  }

  /**
   * Retry apenas oportunidades com falha de scraping
   */
  async retryFailedScraping(
    userId: string,
  ): Promise<{ enqueued: number; byStatus: Record<string, number>; skippedExpired: number }> {
    const failStatuses = [ScrapingStatus.FAILED, ScrapingStatus.BLOCKED, ScrapingStatus.TIMEOUT, ScrapingStatus.NECO_ERROR];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const opportunities = await this.prisma.opportunity.findMany({
      where: {
        userId,
        scrapingStatus: { in: failStatuses },
        sourceUrl: { not: null },
        deletedAt: null,
        status: { not: 'cancelada' },
        OR: [
          { closingDate: { gte: today } },
          { closingDate: null },
        ],
      },
      select: {
        id: true,
        sourceUrl: true,
        templateId: true,
        scrapingStatus: true,
      },
    });

    // Conta puladas por expiração
    const totalFailed = await this.prisma.opportunity.count({
      where: {
        userId,
        scrapingStatus: { in: failStatuses },
        sourceUrl: { not: null },
        deletedAt: null,
      },
    });
    const skippedExpired = totalFailed - opportunities.length;

    // Contar por status antes de resetar
    const byStatus: Record<string, number> = {};
    for (const opp of opportunities) {
      const status = opp.scrapingStatus || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    // Resetar status para 'pending'
    if (opportunities.length > 0) {
      const ids = opportunities.filter(o => o.sourceUrl && o.templateId).map(o => o.id);
      await this.prisma.opportunity.updateMany({
        where: { id: { in: ids } },
        data: { scrapingStatus: ScrapingStatus.PENDING, scrapingError: null },
      });
    }

    let enqueued = 0;
    for (const opp of opportunities) {
      if (!opp.sourceUrl || !opp.templateId) continue;

      await this.addScrapingJob({
        opportunityId: opp.id,
        userId,
        templateId: opp.templateId,
        sourceUrl: opp.sourceUrl,
      });
      enqueued++;
    }

    this.logger.log(
      `Retry failed: enqueued ${enqueued} scraping jobs for user ${userId} (${JSON.stringify(byStatus)}, skippedExpired=${skippedExpired})`,
    );

    return { enqueued, byStatus, skippedExpired };
  }

  /**
   * Pausa a fila de scraping (jobs ativos terminam, novos não iniciam)
   */
  async pauseScrapingQueue(): Promise<{ paused: boolean }> {
    await this.scrapingQueue.pause();
    this.logger.log('Scraping queue PAUSED');
    return { paused: true };
  }

  /**
   * Retoma a fila de scraping
   */
  async resumeScrapingQueue(): Promise<{ resumed: boolean }> {
    await this.scrapingQueue.resume();
    this.logger.log('Scraping queue RESUMED');
    return { resumed: true };
  }

  /**
   * Limpa todos os jobs pendentes da fila de scraping (não afeta jobs ativos)
   */
  async drainScrapingQueue(): Promise<{ drained: boolean; removed: number }> {
    // Conta jobs antes de drenar
    const counts = await this.scrapingQueue.getJobCounts();
    const pendingCount = (counts.waiting || 0) + (counts.delayed || 0);

    await this.scrapingQueue.empty();

    // Limpa jobs delayed também
    const delayed = await this.scrapingQueue.getDelayed();
    for (const job of delayed) {
      await job.remove();
    }

    this.logger.log(`Scraping queue DRAINED: ${pendingCount} jobs removed`);
    return { drained: true, removed: pendingCount };
  }

  /**
   * Cancela tudo: drena fila + reseta status no banco
   */
  async cancelScrapingQueue(userId: string): Promise<{ cancelled: boolean; removed: number; resetInDb: number }> {
    // 1. Resume se pausada
    const isPaused = await this.scrapingQueue.isPaused();
    if (isPaused) {
      await this.scrapingQueue.resume();
    }

    // 2. Remove TODOS os jobs waiting individualmente (mais confiavel que empty())
    const waiting = await this.scrapingQueue.getWaiting(0, 10000);
    for (const job of waiting) {
      try { await job.remove(); } catch {}
    }

    // 3. Remove delayed
    const delayed = await this.scrapingQueue.getDelayed(0, 10000);
    for (const job of delayed) {
      try { await job.remove(); } catch {}
    }

    // 4. Move jobs ativos para failed (nao pode matar o worker, mas marca como cancelado)
    const active = await this.scrapingQueue.getActive(0, 100);
    for (const job of active) {
      try { await job.discard(); } catch {}
      try { await job.moveToFailed(new Error('Cancelled by user'), true); } catch {}
    }

    const removed = waiting.length + delayed.length + active.length;

    // 5. Limpa completed/failed da fila Bull
    await this.scrapingQueue.clean(0, 'completed');
    await this.scrapingQueue.clean(0, 'failed');

    // 6. Tambem chama empty() como fallback
    try { await this.scrapingQueue.empty(); } catch {}

    // 7. Reseta status 'pending' e 'disabled' no banco para NULL (limpo)
    const resetResult = await this.prisma.opportunity.updateMany({
      where: {
        userId,
        scrapingStatus: { in: [ScrapingStatus.PENDING, ScrapingStatus.DISABLED] },
      },
      data: {
        scrapingStatus: null,
      },
    });

    this.logger.log(`Scraping queue CANCELLED: ${removed} jobs removed, ${resetResult.count} DB records reset, isPaused was ${isPaused}`);
    return { cancelled: true, removed, resetInDb: resetResult.count };
  }

  /**
   * Verifica se a fila de scraping está pausada
   */
  /**
   * Retorna logs de scraping paginados a partir da tabela opportunities
   */
  async getScrapingLogs(
    userId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ) {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
      sourceUrl: { not: null },
      deletedAt: null,
    };

    if (filters?.status) {
      where.scrapingStatus = filters.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select: {
          id: true,
          solicitationNumber: true,
          sourceUrl: true,
          scrapingStatus: true,
          scrapingError: true,
          scrapedAt: true,
        },
        orderBy: { scrapedAt: { sort: 'desc', nulls: 'last' } },
        skip,
        take: limit,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async isScrapingQueuePaused(): Promise<boolean> {
    return this.scrapingQueue.isPaused();
  }

  /**
   * Retorna progresso do scraping: contagens do banco + fila Bull
   */
  async getScrapingProgress(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [dbStats, expiredCount, queueCounts] = await Promise.all([
      this.prisma.opportunity.groupBy({
        by: ['scrapingStatus'],
        where: {
          userId,
          sourceUrl: { not: null },
          deletedAt: null,
          OR: [
            { closingDate: { gte: today } },
            { closingDate: null },
          ],
        },
        _count: { _all: true },
      }),
      this.prisma.opportunity.count({
        where: {
          userId,
          sourceUrl: { not: null },
          deletedAt: null,
          closingDate: { lt: today },
        },
      }),
      this.scrapingQueue.getJobCounts(),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const item of dbStats) {
      const key = item.scrapingStatus || 'pending';
      byStatus[key] = (byStatus[key] || 0) + item._count._all;
      total += item._count._all;
    }

    const isPaused = await this.scrapingQueue.isPaused();

    return {
      total,
      expired: expiredCount,
      isPaused,
      success: byStatus[ScrapingStatus.SUCCESS] || 0,
      pending: byStatus[ScrapingStatus.PENDING] || 0,
      failed: byStatus[ScrapingStatus.FAILED] || 0,
      blocked: byStatus[ScrapingStatus.BLOCKED] || 0,
      timeout: byStatus[ScrapingStatus.TIMEOUT] || 0,
      necoError: byStatus[ScrapingStatus.NECO_ERROR] || 0,
      queue: {
        waiting: queueCounts.waiting || 0,
        active: queueCounts.active || 0,
        completed: queueCounts.completed || 0,
        failed: queueCounts.failed || 0,
        delayed: queueCounts.delayed || 0,
      },
    };
  }
}
