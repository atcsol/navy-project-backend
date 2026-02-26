import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { QueuesService } from './queues.service';
import { EnqueueScrapingDto } from './dto/enqueue-scraping.dto';

@Controller('queues')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QueuesController {
  constructor(private readonly queuesService: QueuesService) {}

  /**
   * Estatísticas das filas
   * GET /api/queues/stats
   */
  @Get('stats')
  @RequirePermission('queues.view')
  getStats() {
    return this.queuesService.getQueueStats();
  }

  /**
   * Logs recentes de todas as filas (email-sync, opportunity-processing, scraping)
   * GET /api/queues/logs?limit=50
   */
  @Get('logs')
  @RequirePermission('queues.view')
  getLogs(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.queuesService.getRecentLogs(Math.min(parsedLimit, 200));
  }

  /**
   * Enfileira oportunidades para scraping via Bull queue (background)
   * POST /api/queues/scraping/enqueue
   * Body: { rescrape?: boolean }
   */
  @Post('scraping/enqueue')
  @RequirePermission('scraping.manage')
  async enqueueScraping(
    @CurrentUser() user: UserEntity,
    @Body() dto: EnqueueScrapingDto,
  ) {
    return this.queuesService.bulkEnqueueScraping({
      rescrape: dto.rescrape || false,
    });
  }

  /**
   * Retry apenas oportunidades com falha de scraping (failed, blocked, timeout, neco_error)
   * POST /api/queues/scraping/retry-failed
   */
  @Post('scraping/retry-failed')
  @RequirePermission('scraping.manage')
  async retryFailedScraping(@CurrentUser() user: UserEntity) {
    return this.queuesService.retryFailedScraping();
  }

  /**
   * Logs de scraping (dados da tabela opportunities)
   * GET /api/queues/scraping/logs?status=failed&page=1&limit=50
   */
  @Get('scraping/logs')
  @RequirePermission('scraping.view')
  async scrapingLogs(
    @CurrentUser() user: UserEntity,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.queuesService.getScrapingLogs({
      status: status || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /**
   * Progresso do scraping (contagens do DB + fila Bull)
   * GET /api/queues/scraping/progress
   */
  @Get('scraping/progress')
  @RequirePermission('scraping.view')
  async scrapingProgress(@CurrentUser() user: UserEntity) {
    return this.queuesService.getScrapingProgress();
  }

  /**
   * Pausar fila de scraping
   * POST /api/queues/scraping/pause
   */
  @Post('scraping/pause')
  @RequirePermission('scraping.manage')
  async pauseScraping() {
    return this.queuesService.pauseScrapingQueue();
  }

  /**
   * Retomar fila de scraping
   * POST /api/queues/scraping/resume
   */
  @Post('scraping/resume')
  @RequirePermission('scraping.manage')
  async resumeScraping() {
    return this.queuesService.resumeScrapingQueue();
  }

  /**
   * Limpar fila de scraping (remove jobs pendentes, mantém ativos)
   * POST /api/queues/scraping/drain
   */
  @Post('scraping/drain')
  @RequirePermission('scraping.manage')
  async drainScraping() {
    return this.queuesService.drainScrapingQueue();
  }

  /**
   * Cancelar tudo: limpa fila + reseta status no banco
   * POST /api/queues/scraping/cancel
   */
  @Post('scraping/cancel')
  @RequirePermission('scraping.manage')
  async cancelScraping(@CurrentUser() user: UserEntity) {
    return this.queuesService.cancelScrapingQueue();
  }
}
