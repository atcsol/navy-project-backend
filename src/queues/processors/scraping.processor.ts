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

    try {
      const result = await this.scrapingService.scrapeOpportunityAuto(
        opportunityId,
        userId,
        templateId,
      );

      this.logger.log(
        `Scraping job for opportunity ${opportunityId}: status=${result.status}, success=${result.success}`,
      );

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

      // Circuit breaker: se NECO retornou erro, parar toda a fila
      if (result.status === ScrapingStatus.NECO_ERROR) {
        await this.drainQueue();
        return result;
      }

      // Delay aleatório configurável pelo usuário (default 3-7s)
      const settings = await this.scrapingService.getSettings(userId);
      const range = settings.maxDelayMs - settings.minDelayMs;
      const randomDelay = settings.minDelayMs + Math.floor(Math.random() * (range + 1));
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      return result;
    } catch (error) {
      this.logger.error(
        `Scraping job failed for opportunity ${opportunityId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Esvazia a fila de scraping — remove todos os jobs pendentes.
   * Chamado quando NECO retorna erro (possível bloqueio de IP).
   */
  private async drainQueue(): Promise<void> {
    try {
      const waiting = await this.scrapingQueue.getWaiting(0, 99999);
      const delayed = await this.scrapingQueue.getDelayed(0, 99999);
      const allJobs = [...waiting, ...delayed];

      this.logger.warn(
        `CIRCUIT BREAKER: NECO error detectado. Removendo ${allJobs.length} jobs da fila.`,
      );

      for (const j of allJobs) {
        await j.remove();
      }

      this.logger.warn(
        `Fila de scraping esvaziada. ${allJobs.length} jobs removidos. Tente novamente mais tarde.`,
      );
    } catch (err) {
      this.logger.error(`Erro ao esvaziar fila: ${err.message}`);
    }
  }
}
