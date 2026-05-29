import { Process, Processor, InjectQueue } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { ScrapingService } from '../../scraping/scraping.service';
import { ChildOpportunitiesService } from '../../opportunities/child-opportunities.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrapingStatus } from '../../common/constants/opportunity.constants';
import { NecoExtractedData } from '../../scraping/neco-extractor';

export interface ScrapingJob {
  opportunityId: string;
  userId: string;
  templateId: string;
  sourceUrl: string;
}

@Processor('scraping')
export class ScrapingProcessorQueue {
  private readonly logger = new Logger(ScrapingProcessorQueue.name);

  /** Tempo que a fila fica pausada após o NECO bloquear, antes de retomar sozinha */
  private static readonly NECO_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

  /** Timer de retomada automática (evita múltiplos agendamentos sobrepostos) */
  private resumeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly childOpportunitiesService: ChildOpportunitiesService,
    private readonly prisma: PrismaService,
    @InjectQueue('scraping')
    private readonly scrapingQueue: Queue<ScrapingJob>,
  ) {}

  @Process('scrape-opportunity')
  async handleScraping(job: Job<ScrapingJob>) {
    const { opportunityId, userId, templateId, sourceUrl } = job.data;

    this.logger.log(
      `Processing scraping job for opportunity ${opportunityId}, URL: ${sourceUrl}`,
    );

    // Pula oportunidades canceladas ou com data vencida (economiza requests)
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { closingDate: true, status: true, deletedAt: true },
    });

    if (!opportunity || opportunity.deletedAt || opportunity.status === 'cancelada') {
      this.logger.log(`Skipping scraping for ${opportunityId}: cancelled or deleted`);
      return { success: false, status: 'skipped', error: 'Opportunity cancelled or deleted', scrapedAt: new Date() };
    }

    if (opportunity.closingDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (opportunity.closingDate < today) {
        this.logger.log(`Skipping scraping for ${opportunityId}: closing date expired (${opportunity.closingDate.toISOString()})`);
        return { success: false, status: 'skipped', error: 'Closing date expired', scrapedAt: new Date() };
      }
    }

    const startTime = Date.now();

    try {
      const result = await this.scrapingService.scrapeOpportunityAuto(
        opportunityId,
        templateId,
      );

      this.logger.log(
        `Scraping job for opportunity ${opportunityId}: status=${result.status}, success=${result.success}`,
      );

      // Grava log no banco
      try {
        await this.prisma.queueJobLog.create({
          data: {
            queue: 'scraping',
            jobId: String(job.id),
            status: result.success ? 'completed' : 'failed',
            opportunityId,
            templateId,
            sourceUrl,
            durationMs: Date.now() - startTime,
            error: result.error || null,
            metadata: { scrapingStatus: result.status },
          },
        });
      } catch (logErr) {
        this.logger.error(`Failed to save job log: ${logErr.message}`);
      }

      // Cria oportunidades filhas se multi-line items (P3)
      if (result.success && result.data?.neco) {
        const necoData = result.data.neco as NecoExtractedData;
        if (necoData.totalLineItems > 1) {
          try {
            const childrenCreated = await this.childOpportunitiesService.createChildrenFromScraping(
              opportunityId,
              necoData,
            );
            this.logger.log(`Created ${childrenCreated} children for ${opportunityId}`);
          } catch (err) {
            this.logger.error(`Failed to create children for ${opportunityId}: ${err.message}`);
          }
        }
      }

      // Circuit breaker: se NECO retornou erro (provável bloqueio de IP), pausa a
      // fila por um cooldown e retoma automaticamente. NÃO apaga os jobs — assim
      // o scraping volta sozinho depois, sem precisar de clique manual.
      if (result.status === ScrapingStatus.NECO_ERROR) {
        await this.pauseWithAutoResume(ScrapingProcessorQueue.NECO_COOLDOWN_MS);
        return result;
      }

      // Delay aleatório configurável pelo usuário (default 3-7s)
      const settings = await this.scrapingService.getSettings(userId);
      const range = settings.maxDelayMs - settings.minDelayMs;
      const randomDelay = settings.minDelayMs + Math.floor(Math.random() * (range + 1));
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      return result;
    } catch (error) {
      // Grava falha no banco
      try {
        await this.prisma.queueJobLog.create({
          data: {
            queue: 'scraping',
            jobId: String(job.id),
            status: 'failed',
            opportunityId,
            templateId,
            sourceUrl,
            durationMs: Date.now() - startTime,
            error: error.message,
          },
        });
      } catch (logErr) {
        this.logger.error(`Failed to save job log: ${logErr.message}`);
      }

      this.logger.error(
        `Scraping job failed for opportunity ${opportunityId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Circuit breaker: pausa a fila por um cooldown e agenda retomada automática.
   * NÃO remove jobs — quando a fila retoma, os jobs pendentes continuam de onde
   * pararam. Assim o scraping se recupera sozinho do bloqueio do NECO sem clique.
   */
  private async pauseWithAutoResume(cooldownMs: number): Promise<void> {
    await this.scrapingQueue.pause();
    this.logger.warn(
      `CIRCUIT BREAKER: NECO bloqueou. Fila de scraping PAUSADA por ${Math.round(cooldownMs / 60000)}min. Retomada automática agendada.`,
    );

    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
    }
    this.resumeTimer = setTimeout(() => {
      this.scrapingQueue
        .resume()
        .then(() =>
          this.logger.log('CIRCUIT BREAKER: cooldown terminou, fila de scraping RETOMADA automaticamente'),
        )
        .catch((err) => this.logger.error(`Falha ao retomar fila: ${err.message}`));
      this.resumeTimer = null;
    }, cooldownMs);
    this.resumeTimer.unref?.();
  }
}
