import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { UpsertDomainDto } from './dto/upsert-domain.dto';
import { UpdateScrapingSettingsDto } from './dto/update-scraping-settings.dto';
import { ChildOpportunitiesService } from '../opportunities/child-opportunities.service';
import { PrismaService } from '../prisma/prisma.service';
import { NecoExtractedData } from './neco-extractor';

@Controller('scraping')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly childOpportunitiesService: ChildOpportunitiesService,
    private readonly prisma: PrismaService,
  ) {}

  // ===== Scraping Settings =====

  /**
   * Retorna configurações de scraping do usuário
   * GET /api/scraping/settings
   */
  @Get('settings')
  @RequirePermission('scraping.view')
  getSettings(@CurrentUser() user: UserEntity) {
    return this.scrapingService.getSettings(user.id);
  }

  /**
   * Atualiza configurações de scraping do usuário
   * PUT /api/scraping/settings
   */
  @Put('settings')
  @RequirePermission('scraping.manage')
  updateSettings(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateScrapingSettingsDto,
  ) {
    return this.scrapingService.updateSettings(user.id, dto);
  }

  /**
   * Faz scraping de uma oportunidade específica
   * POST /api/scraping/opportunities/:id
   */
  @Post('opportunities/:id')
  @RequirePermission('scraping.manage')
  scrapeOpportunity(
    @Param('id') opportunityId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.scrapingService.scrapeOpportunity(opportunityId, user.id);
  }

  /**
   * Obtém estatísticas de scraping do usuário
   * GET /api/scraping/statistics
   */
  @Get('statistics')
  @RequirePermission('scraping.view')
  getStatistics(@CurrentUser() user: UserEntity) {
    return this.scrapingService.getStatistics(user.id);
  }

  // ===== Domain Configs CRUD =====

  /**
   * Lista todos os domínios configurados
   * GET /api/scraping/domains
   */
  @Get('domains')
  @RequirePermission('scraping.view')
  async getDomains(@CurrentUser() user: UserEntity) {
    // Inicializa domínios padrão se necessário
    await this.scrapingService.initializeDefaultDomains(user.id);
    return this.scrapingService.getDomainConfigs(user.id);
  }

  /**
   * Cria ou atualiza configuração de domínio
   * PUT /api/scraping/domains
   * Body: { domain: "neco.navy.mil", enabled: true, requiresAuth: false, reason: "...", timeoutMs: 30000 }
   */
  @Put('domains')
  @RequirePermission('scraping.manage')
  upsertDomain(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpsertDomainDto,
  ) {
    return this.scrapingService.upsertDomainConfig(user.id, dto.domain, {
      enabled: dto.enabled,
      requiresAuth: dto.requiresAuth,
      reason: dto.reason,
      timeoutMs: dto.timeoutMs,
    });
  }

  /**
   * Remove configuração de domínio
   * DELETE /api/scraping/domains/:id
   */
  @Delete('domains/:id')
  @RequirePermission('scraping.manage')
  async removeDomain(
    @Param('id') domainId: string,
    @CurrentUser() user: UserEntity,
  ) {
    await this.scrapingService.removeDomainConfig(user.id, domainId);
    return { message: 'Domain config removed' };
  }

  /**
   * Reprocessa rawHtml existente no banco com extrator melhorado.
   * POST /api/scraping/reprocess?onlyFailed=true&limit=500
   */
  @Post('reprocess')
  @RequirePermission('scraping.manage')
  async reprocessRawHtml(
    @CurrentUser() user: UserEntity,
    @Query('onlyFailed') onlyFailed?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.scrapingService.reprocessFromRawHtml(user.id, {
      onlyFailed: onlyFailed === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    // Criar filhas para oportunidades com múltiplos line items
    let childrenCreated = 0;
    for (const r of result.results) {
      if (r.success && r.totalLineItems > 1) {
        try {
          const opp = await this.prisma.opportunity.findUnique({
            where: { id: r.id },
            select: { scrapedData: true },
          });
          const necoData = (opp?.scrapedData as Record<string, unknown>)?.neco as NecoExtractedData | undefined;
          if (necoData) {
            childrenCreated += await this.childOpportunitiesService.createChildrenFromScraping(r.id, necoData);
          }
        } catch {
          // Log but don't fail the whole operation
        }
      }
    }

    return { ...result, childrenCreated };
  }
}
