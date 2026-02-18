import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ScrapingSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';
import UserAgent from 'user-agents';
import { NecoExtractor, NecoExtractedData } from './neco-extractor';
import { ScrapingStatus } from '../common/constants/opportunity.constants';
import { UpdateScrapingSettingsDto } from './dto/update-scraping-settings.dto';
import { AlertsService } from '../alerts/alerts.service';
import { AlertsGateway } from '../alerts/alerts.gateway';

export interface ScrapingConfig {
  enabled: boolean;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  userAgent?: string;
}

export interface DomainConfig {
  enabled: boolean;
  requiresAuth: boolean;
  timeout?: number;
  credentials?: {
    username: string;
    password: string;
  };
  customHeaders?: Record<string, string>;
  reason?: string;
}

export interface ScrapingResult {
  success: boolean;
  status: string;
  data?: Record<string, unknown>;
  error?: string;
  isCancellation?: boolean;
  scrapedAt: Date;
}

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);
  private axiosInstance: AxiosInstance;

  private readonly defaultConfig: ScrapingConfig = {
    enabled: true,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 2000,
  };

  // Domínios padrão (fallback se não houver config no banco)
  private readonly defaultDomainConfigs: Map<string, DomainConfig> = new Map([
    [
      'neco.navy.mil',
      {
        enabled: true,
        requiresAuth: false,
        timeout: 30000,
      },
    ],
  ]);

  constructor(
    private prisma: PrismaService,
    private alertsService: AlertsService,
    private alertsGateway: AlertsGateway,
  ) {
    // Agente HTTPS que aceita certificados self-signed (necessário para sites .mil)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    this.axiosInstance = axios.create({
      timeout: this.defaultConfig.timeout,
      httpsAgent,
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Interceptor: rotaciona User-Agent a cada request para evitar detecção
    this.axiosInstance.interceptors.request.use((config) => {
      config.headers['User-Agent'] = new UserAgent().toString();
      return config;
    });
  }

  // ===== Scraping Settings =====

  /**
   * Retorna settings do usuário, criando com defaults se não existir
   */
  async getSettings(userId: string): Promise<ScrapingSettings> {
    return this.prisma.scrapingSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Atualiza settings do usuário
   */
  async updateSettings(
    userId: string,
    dto: UpdateScrapingSettingsDto,
  ): Promise<ScrapingSettings> {
    // Validação: minDelay < maxDelay
    if (dto.minDelayMs != null && dto.maxDelayMs != null && dto.minDelayMs > dto.maxDelayMs) {
      const temp = dto.minDelayMs;
      dto.minDelayMs = dto.maxDelayMs;
      dto.maxDelayMs = temp;
    }

    return this.prisma.scrapingSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...dto,
      },
      update: dto,
    });
  }

  /**
   * Faz scraping de uma oportunidade
   */
  async scrapeOpportunity(
    opportunityId: string,
    userId: string,
  ): Promise<ScrapingResult> {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, userId },
    });

    if (!opportunity) {
      return {
        success: false,
        status: ScrapingStatus.FAILED,
        error: 'Opportunity not found',
        scrapedAt: new Date(),
      };
    }

    if (!opportunity.sourceUrl) {
      return {
        success: false,
        status: ScrapingStatus.FAILED,
        error: 'No source URL available',
        scrapedAt: new Date(),
      };
    }

    // Verifica se scraping está habilitado para este domínio
    const domain = this.extractDomain(opportunity.sourceUrl);

    // Verifica domínios configurados no template primeiro
    let domainConfig: DomainConfig;
    const webScrapingConfig = await this.prisma.webScrapingConfig.findUnique({
      where: { templateId: opportunity.templateId },
    });
    const rules = webScrapingConfig?.extractionRules as Record<string, unknown> | null;
    const templateDomains = (rules?.templateDomains || []) as Array<{ domain: string; enabled: boolean; reason?: string }>;
    const domainNorm = domain.replace(/^www\./, '');
    const templateDomain = templateDomains.find(
      (d) =>
        d.domain === domain ||
        d.domain === domainNorm ||
        d.domain === `www.${domainNorm}` ||
        domain.endsWith(`.${d.domain}`) ||
        domain === `www.${d.domain}`,
    );

    if (templateDomain) {
      domainConfig = {
        enabled: templateDomain.enabled,
        requiresAuth: false,
        timeout: this.defaultConfig.timeout,
        reason: templateDomain.reason,
      };
    } else {
      // Fallback para config global
      domainConfig = await this.getDomainConfig(domain, userId);
    }

    if (!domainConfig.enabled) {
      this.logger.warn(
        `Scraping disabled for domain ${domain}: ${domainConfig.reason || 'No reason provided'}`,
      );

      await this.updateScrapingStatus(
        opportunityId,
        ScrapingStatus.BLOCKED,
        domainConfig.reason || 'Domain blocked',
      );

      return {
        success: false,
        status: ScrapingStatus.BLOCKED,
        error: domainConfig.reason || 'Scraping disabled for this domain',
        scrapedAt: new Date(),
      };
    }

    if (domainConfig.requiresAuth && !domainConfig.credentials) {
      await this.updateScrapingStatus(
        opportunityId,
        ScrapingStatus.REQUIRES_AUTH,
        'Domain requires authentication but no credentials configured',
      );

      return {
        success: false,
        status: ScrapingStatus.REQUIRES_AUTH,
        error: 'Authentication required but not configured',
        scrapedAt: new Date(),
      };
    }

    return this.scrapeWithRetry(opportunity.sourceUrl, opportunityId, domainConfig, userId);
  }

  /**
   * Scraping automático após criação de oportunidade
   * Verifica se o template tem scraping habilitado
   */
  async scrapeOpportunityAuto(
    opportunityId: string,
    userId: string,
    templateId: string,
  ): Promise<ScrapingResult> {
    // Verifica se template tem scraping habilitado
    const webScrapingConfig = await this.prisma.webScrapingConfig.findUnique({
      where: { templateId },
    });

    if (!webScrapingConfig || !webScrapingConfig.isEnabled) {
      this.logger.debug(
        `Scraping not enabled for template ${templateId}`,
      );
      return {
        success: false,
        status: ScrapingStatus.DISABLED,
        error: 'Scraping not enabled for this template',
        scrapedAt: new Date(),
      };
    }

    return this.scrapeOpportunity(opportunityId, userId);
  }

  /**
   * Faz scraping com retry automático
   */
  private async scrapeWithRetry(
    url: string,
    opportunityId: string,
    domainConfig: DomainConfig,
    userId?: string,
    attempt: number = 1,
  ): Promise<ScrapingResult> {
    // Carrega settings do usuário (ou usa defaults)
    const settings = userId ? await this.getSettings(userId) : null;
    const maxRetries = settings?.maxRetries ?? this.defaultConfig.maxRetries;
    const retryDelay = settings?.retryDelayMs ?? this.defaultConfig.retryDelay;
    const globalTimeout = settings?.globalTimeoutMs ?? this.defaultConfig.timeout;

    try {
      this.logger.log(
        `Scraping ${url} (attempt ${attempt}/${maxRetries})`,
      );

      if (attempt === 1) {
        await this.updateScrapingStatus(opportunityId, ScrapingStatus.PENDING);
      }

      const response = await this.axiosInstance.get(url, {
        timeout: domainConfig.timeout || globalTimeout,
        headers: domainConfig.customHeaders,
      });

      const htmlContent = response.data as string;
      const $ = cheerio.load(htmlContent);

      // Detecta página de erro do NECO (retorna HTTP 200 mas é uma página de erro)
      const pageTitle = $('title').text().trim().toLowerCase();
      const bodyText = $('body').text().trim();
      if (
        pageTitle.includes('error page') ||
        bodyText.includes('An Error Has Occured') ||
        bodyText.includes('An Error Has Occurred')
      ) {
        throw {
          isNecoError: true,
          message: 'NECO retornou pagina de erro - possivel bloqueio de IP ou pagina indisponivel',
          response: { status: 200 },
        };
      }

      // Extrai dados baseado no domínio
      const scrapedData = this.extractData($, url);

      // Detecta cancelamento via dados scrapeados (NECO)
      const isCancellation = scrapedData.isCancellation === true;

      // Salva no banco (dados estruturados + HTML bruto) + enriquece colunas
      const currentOpp = await this.prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { description: true },
      });
      const enrichData = this.buildEnrichmentData(scrapedData, currentOpp?.description);
      await this.prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          scrapedData: scrapedData as unknown as Prisma.InputJsonValue,
          rawHtml: htmlContent,
          scrapedAt: new Date(),
          scrapingStatus: ScrapingStatus.SUCCESS,
          scrapingError: null,
          ...enrichData,
        },
      });

      // Se cancelamento detectado via scraping, cancela a oportunidade
      if (isCancellation) {
        await this.handleScrapingCancellation(opportunityId);
      }

      this.logger.log(`Successfully scraped ${url}${isCancellation ? ' [CANCELLATION DETECTED]' : ''}`);

      return {
        success: true,
        status: ScrapingStatus.SUCCESS,
        data: scrapedData,
        isCancellation,
        scrapedAt: new Date(),
      };
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        if (attempt < maxRetries) {
          this.logger.warn(`Timeout on ${url}, retrying in ${retryDelay}ms`);
          await this.delay(retryDelay);
          return this.scrapeWithRetry(url, opportunityId, domainConfig, userId, attempt + 1);
        }

        await this.updateScrapingStatus(opportunityId, ScrapingStatus.TIMEOUT, errorMessage);
        await this.emitScrapingErrorAlert(opportunityId, userId, ScrapingStatus.TIMEOUT, errorMessage, url);
        return {
          success: false,
          status: ScrapingStatus.TIMEOUT,
          error: errorMessage,
          scrapedAt: new Date(),
        };
      }

      // NECO retornou página de erro (HTTP 200 mas conteúdo é erro)
      if (error.isNecoError) {
        this.logger.warn(`NECO error page detected for ${url} - not retrying`);
        await this.updateScrapingStatus(opportunityId, ScrapingStatus.NECO_ERROR, errorMessage);
        await this.emitScrapingErrorAlert(opportunityId, userId, ScrapingStatus.NECO_ERROR, errorMessage, url);
        return {
          success: false,
          status: ScrapingStatus.NECO_ERROR,
          error: errorMessage,
          scrapedAt: new Date(),
        };
      }

      if (error.response?.status === 403 || error.response?.status === 401) {
        await this.updateScrapingStatus(opportunityId, ScrapingStatus.BLOCKED, errorMessage);
        await this.emitScrapingErrorAlert(opportunityId, userId, ScrapingStatus.BLOCKED, errorMessage, url);
        return {
          success: false,
          status: ScrapingStatus.BLOCKED,
          error: errorMessage,
          scrapedAt: new Date(),
        };
      }

      if (error.response?.status === 404) {
        await this.updateScrapingStatus(opportunityId, ScrapingStatus.FAILED, 'Page not found (404)');
        await this.emitScrapingErrorAlert(opportunityId, userId, ScrapingStatus.FAILED, 'Page not found (404)', url);
        return {
          success: false,
          status: ScrapingStatus.FAILED,
          error: 'Page not found (404)',
          scrapedAt: new Date(),
        };
      }

      if (attempt < maxRetries) {
        this.logger.warn(`Error scraping ${url}, retrying: ${errorMessage}`);
        await this.delay(retryDelay);
        return this.scrapeWithRetry(url, opportunityId, domainConfig, userId, attempt + 1);
      }

      await this.updateScrapingStatus(opportunityId, ScrapingStatus.FAILED, errorMessage);
      await this.emitScrapingErrorAlert(opportunityId, userId, ScrapingStatus.FAILED, errorMessage, url);
      return {
        success: false,
        status: ScrapingStatus.FAILED,
        error: errorMessage,
        scrapedAt: new Date(),
      };
    }
  }

  /**
   * Extrai dados da página, usando extrator específico por domínio
   */
  private extractData($: cheerio.CheerioAPI, url: string): Record<string, unknown> {
    const domain = this.extractDomain(url);

    // Extração genérica (sempre presente)
    const data: Record<string, unknown> = {
      title: $('title').text().trim(),
      url,
      scrapedAt: new Date().toISOString(),
    };

    // Extração NECO específica
    if (domain.includes('neco.navy.mil')) {
      const necoData = NecoExtractor.extract($);
      data.neco = necoData;

      // === Backward-compat: campos flat de primeiro nível ===
      if (necoData.lineItem) data.lineItem = necoData.lineItem;
      if (necoData.nomenclature) data.nomenclature = necoData.nomenclature;
      if (necoData.quantity !== undefined) data.quantity = necoData.quantity;
      if (necoData.unit) data.unit = necoData.unit;
      if (necoData.nsn) data.nsn = necoData.nsn;
      if (necoData.materialControlCode) data.materialControlCode = necoData.materialControlCode;
      if (necoData.vendorCode) data.vendorCode = necoData.vendorCode;
      if (necoData.vendorPartNumber) data.vendorPartNumber = necoData.vendorPartNumber;
      if (necoData.cageRefNo) data.cageRefNo = necoData.cageRefNo;
      if (necoData.contractType) data.contractType = necoData.contractType;
      if (necoData.purchaseCategory) data.purchaseCategory = necoData.purchaseCategory;
      if (necoData.fsc) data.fsc = necoData.fsc;
      if (necoData.issueDate) data.issueDate = necoData.issueDate;
      if (necoData.closingDate) data.closingDate = necoData.closingDate;
      if (necoData.closingTime) data.closingTime = necoData.closingTime;
      if (necoData.leadTime) data.leadTime = necoData.leadTime;
      if (necoData.leadTimeDays) data.leadTimeDays = necoData.leadTimeDays;
      if (necoData.buyerName) data.buyerName = necoData.buyerName;
      if (necoData.buyerEmail) data.buyerEmail = necoData.buyerEmail;
      if (necoData.buyerPhone) data.buyerPhone = necoData.buyerPhone;
      if (necoData.buyerFax) data.buyerFax = necoData.buyerFax;
      if (necoData.adminCommunications) data.adminCommunications = necoData.adminCommunications;
      if (necoData.subLineItems) data.subLineItems = necoData.subLineItems;
      if (necoData.purchaseRequisitionNo) data.purchaseRequisitionNo = necoData.purchaseRequisitionNo;
      if (necoData.dpasRating) data.dpasRating = necoData.dpasRating;
      if (necoData.setAside) data.setAside = necoData.setAside;

      // === Novos campos globais ===
      if (necoData.solicitationNumber) data.solicitationNumber = necoData.solicitationNumber;
      if (necoData.transPurpose) data.transPurpose = necoData.transPurpose;
      if (necoData.tdpDrawings) data.tdpDrawings = necoData.tdpDrawings;
      if (necoData.closingTimezone) data.closingTimezone = necoData.closingTimezone;
      if (necoData.fobPoint) data.fobPoint = necoData.fobPoint;
      if (necoData.shipmentPayment) data.shipmentPayment = necoData.shipmentPayment;
      if (necoData.acceptancePoint) data.acceptancePoint = necoData.acceptancePoint;
      if (necoData.buyerEntity) data.buyerEntity = necoData.buyerEntity;
      if (necoData.buyerDodaac) data.buyerDodaac = necoData.buyerDodaac;
      if (necoData.buyerCity) data.buyerCity = necoData.buyerCity;
      if (necoData.buyerState) data.buyerState = necoData.buyerState;
      if (necoData.buyerZip) data.buyerZip = necoData.buyerZip;
      if (necoData.documentsUrl) data.documentsUrl = necoData.documentsUrl;
      if (necoData.synopsisUrl) data.synopsisUrl = necoData.synopsisUrl;

      // === Novos arrays ===
      if (necoData.lineItems && necoData.lineItems.length > 0) data.lineItems = necoData.lineItems;
      if (necoData.cdrlItems && necoData.cdrlItems.length > 0) data.cdrlItems = necoData.cdrlItems;

      // === Metadata ===
      data.isCancellation = necoData.isCancellation;
      data.totalLineItems = necoData.totalLineItems;
      data.totalSubLineItems = necoData.totalSubLineItems;
    } else {
      // Extração genérica para outros domínios
      data.meta = {
        description: $('meta[name="description"]').attr('content'),
        keywords: $('meta[name="keywords"]').attr('content'),
      };
      data.text = $('body').text().trim().substring(0, 1000);
    }

    return data;
  }

  /**
   * Extrai dados do scraping para enriquecer colunas da oportunidade (P1)
   * Só sobrescreve campos que estão NULL na oportunidade
   */
  private buildEnrichmentData(
    scrapedData: Record<string, unknown>,
    currentDescription?: string | null,
  ): Record<string, unknown> {
    const neco = scrapedData.neco as NecoExtractedData | undefined;
    if (!neco || !neco.lineItems?.length) return {};

    const first = neco.lineItems[0];
    const enrichment: Record<string, unknown> = {};

    // Quantity e Unit (scraping é a única fonte confiável)
    if (first.quantity) {
      enrichment.quantity = first.quantity;
      if (first.unit) enrichment.unit = first.unit;
    } else if (first.subLineItems?.length) {
      // Line item principal sem quantity — somar dos sub-line items
      const totalQty = first.subLineItems.reduce((sum, sub) => sum + (sub.quantity || 0), 0);
      if (totalQty > 0) {
        enrichment.quantity = totalQty;
        // Usar unit do primeiro sub-line item que tiver
        const firstUnit = first.subLineItems.find(s => s.unit);
        if (firstUnit?.unit) enrichment.unit = firstUnit.unit;
      }
    }

    // Part Number e Condition - só se não for garbage
    if (first.vendorPartNumber) enrichment.partNumber = first.vendorPartNumber;
    if (first.vendorCode) enrichment.manufacturer = first.vendorCode;

    // Condition do item
    if (neco.itemCondition) enrichment.condition = neco.itemCondition;

    // Description: usar nomenclature do scraping se a atual é "LINE ITEM: XXXX"
    if (first.nomenclature && (!currentDescription || /^LINE ITEM/i.test(currentDescription))) {
      enrichment.description = first.nomenclature;
    }

    return enrichment;
  }

  /**
   * Cancela oportunidade quando scraping detecta cancelamento na página NECO
   * Grava alerta no banco e emite via WebSocket
   */
  private async handleScrapingCancellation(opportunityId: string): Promise<void> {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, status: true, solicitationNumber: true, statusHistory: true, userId: true },
    });

    if (!opportunity || opportunity.status === 'cancelada') return;

    const currentHistory = (opportunity.statusHistory as any[]) || [];
    const historyEntry = {
      from: opportunity.status,
      to: 'cancelada',
      at: new Date().toISOString(),
      by: 'system',
      reason: 'Cancelamento detectado automaticamente via scraping da pagina NECO',
    };

    await this.prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        status: 'cancelada',
        cancelledAt: new Date(),
        cancellationSource: 'scraping_auto',
        statusHistory: [...currentHistory, historyEntry],
      },
    });

    // Cria alerta persistido no banco
    const solNum = opportunity.solicitationNumber || opportunityId;
    const alert = await this.alertsService.createAlert({
      userId: opportunity.userId,
      opportunityId,
      type: 'cancellation',
      title: `CANCELAMENTO: ${solNum}`,
      message: `A solicitacao ${solNum} foi CANCELADA. Detectado automaticamente via scraping da pagina NECO (pagina contém indicação de Cancellation).`,
      metadata: {
        detectedBy: 'scraping_auto',
        previousStatus: opportunity.status,
      },
    });

    // Emite via WebSocket em tempo real
    this.alertsGateway.emitCancellation(opportunity.userId, {
      opportunityId,
      solicitationNumber: solNum,
    });
    this.alertsGateway.emitAlert(opportunity.userId, alert);
    this.alertsGateway.emitOpportunityUpdate(opportunity.userId, {
      opportunityId,
      action: 'status_changed',
    });

    this.logger.warn(
      `Opportunity ${opportunityId} (${solNum}) CANCELLED via scraping detection — alert created & WebSocket emitted`,
    );
  }

  /**
   * Cria alerta de erro de scraping e emite via WebSocket
   */
  private async emitScrapingErrorAlert(
    opportunityId: string,
    userId: string | undefined,
    status: string,
    errorMessage: string,
    url: string,
  ): Promise<void> {
    if (!userId) return;

    try {
      const opportunity = await this.prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { solicitationNumber: true },
      });

      const solNum = opportunity?.solicitationNumber || opportunityId.substring(0, 8);

      const STATUS_LABELS: Record<string, string> = {
        [ScrapingStatus.NECO_ERROR]: 'NECO Erro',
        [ScrapingStatus.TIMEOUT]: 'Timeout',
        [ScrapingStatus.BLOCKED]: 'Bloqueado',
        [ScrapingStatus.FAILED]: 'Falha',
      };

      const alert = await this.alertsService.createAlert({
        userId,
        opportunityId,
        type: 'scraping_error',
        title: `Scraping ${STATUS_LABELS[status] || status}: ${solNum}`,
        message: `Erro ao fazer scraping da solicitacao ${solNum}. URL: ${url} — ${errorMessage}`,
        metadata: {
          scrapingStatus: status,
          url,
          error: errorMessage,
        },
      });

      this.alertsGateway.emitAlert(userId, alert);
    } catch (err) {
      this.logger.error(`Failed to emit scraping error alert: ${err.message}`);
    }
  }

  /**
   * Atualiza status de scraping no banco
   */
  private async updateScrapingStatus(
    opportunityId: string,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        scrapingStatus: status,
        scrapingError: error || null,
      },
    });
  }

  /**
   * Extrai domínio de uma URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * Obtém configuração de domínio (primeiro busca no banco, depois fallback padrão)
   */
  async getDomainConfig(domain: string, userId?: string): Promise<DomainConfig> {
    // Busca config do usuário no banco
    if (userId) {
      const dbConfig = await this.prisma.scrapingDomainConfig.findFirst({
        where: {
          userId,
          domain,
        },
      });

      if (dbConfig) {
        return {
          enabled: dbConfig.enabled,
          requiresAuth: dbConfig.requiresAuth,
          timeout: dbConfig.timeoutMs,
          reason: dbConfig.reason || undefined,
          customHeaders: dbConfig.customHeaders as Record<string, string> | undefined,
        };
      }

      // Busca por domínio pai (ex: subdominio.navy.mil -> navy.mil)
      const parts = domain.split('.');
      if (parts.length > 2) {
        const parentDomain = parts.slice(-2).join('.');
        const parentConfig = await this.prisma.scrapingDomainConfig.findFirst({
          where: {
            userId,
            domain: parentDomain,
          },
        });

        if (parentConfig) {
          return {
            enabled: parentConfig.enabled,
            requiresAuth: parentConfig.requiresAuth,
            timeout: parentConfig.timeoutMs,
            reason: parentConfig.reason || undefined,
            customHeaders: parentConfig.customHeaders as Record<string, string> | undefined,
          };
        }
      }
    }

    // Fallback: configuração padrão hardcoded
    if (this.defaultDomainConfigs.has(domain)) {
      return this.defaultDomainConfigs.get(domain)!;
    }

    // Verifica domínio pai no fallback
    const parts = domain.split('.');
    if (parts.length > 2) {
      const parentDomain = parts.slice(-2).join('.');
      if (this.defaultDomainConfigs.has(parentDomain)) {
        return this.defaultDomainConfigs.get(parentDomain)!;
      }
    }

    // Verifica se contém substring de domínio bloqueado
    for (const [blockedDomain, config] of this.defaultDomainConfigs) {
      if (domain.includes(blockedDomain) && !config.enabled) {
        return config;
      }
    }

    // Domínios desconhecidos: desabilitados por segurança
    return {
      enabled: false,
      requiresAuth: false,
      reason: 'Unknown domain - not configured',
    };
  }

  /**
   * Lista domínios configurados do usuário
   */
  async getDomainConfigs(userId: string) {
    const configs = await this.prisma.scrapingDomainConfig.findMany({
      where: { userId },
      orderBy: { domain: 'asc' },
    });

    return configs;
  }

  /**
   * Cria ou atualiza config de domínio
   */
  async upsertDomainConfig(
    userId: string,
    domain: string,
    config: {
      enabled: boolean;
      requiresAuth?: boolean;
      reason?: string;
      timeoutMs?: number;
    },
  ) {
    return this.prisma.scrapingDomainConfig.upsert({
      where: {
        userId_domain: { userId, domain },
      },
      create: {
        userId,
        domain,
        enabled: config.enabled,
        requiresAuth: config.requiresAuth ?? false,
        reason: config.reason || null,
        timeoutMs: config.timeoutMs ?? 30000,
      },
      update: {
        enabled: config.enabled,
        requiresAuth: config.requiresAuth ?? false,
        reason: config.reason || null,
        timeoutMs: config.timeoutMs ?? 30000,
      },
    });
  }

  /**
   * Remove config de domínio
   */
  async removeDomainConfig(userId: string, domainId: string) {
    return this.prisma.scrapingDomainConfig.deleteMany({
      where: { id: domainId, userId },
    });
  }

  /**
   * Inicializa domínios padrão para um usuário (se não existirem)
   */
  async initializeDefaultDomains(userId: string) {
    const existing = await this.prisma.scrapingDomainConfig.count({
      where: { userId },
    });

    if (existing > 0) return;

    const defaults = [
      { domain: 'neco.navy.mil', enabled: true, requiresAuth: false, reason: null },
    ];

    for (const d of defaults) {
      await this.prisma.scrapingDomainConfig.create({
        data: {
          userId,
          domain: d.domain,
          enabled: d.enabled,
          requiresAuth: d.requiresAuth,
          reason: d.reason,
        },
      });
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reprocessa rawHtml existente no banco com o extrator melhorado.
   * Nao faz HTTP request — usa o HTML já salvo.
   * Retorna resultado por oportunidade para criação de filhas pelo chamador.
   */
  async reprocessFromRawHtml(
    userId: string,
    options?: { limit?: number; onlyFailed?: boolean },
  ): Promise<{
    processed: number;
    enriched: number;
    errors: number;
    results: Array<{ id: string; totalLineItems: number; success: boolean; error?: string }>;
  }> {
    const where: Prisma.OpportunityWhereInput = {
      userId,
      rawHtml: { not: null },
      sourceUrl: { not: null },
      deletedAt: null,
      parentOpportunityId: null, // Só parents
    };

    if (options?.onlyFailed) {
      where.scrapingStatus = { in: ['failed', 'blocked', 'timeout', 'neco_error'] };
    }

    const opportunities = await this.prisma.opportunity.findMany({
      where,
      select: { id: true, rawHtml: true, sourceUrl: true, description: true },
      take: options?.limit || 5000,
      orderBy: { createdAt: 'desc' },
    });

    this.logger.log(`Reprocessing ${opportunities.length} opportunities from rawHtml`);

    let processed = 0;
    let enriched = 0;
    let errors = 0;
    const results: Array<{ id: string; totalLineItems: number; success: boolean; error?: string }> = [];

    for (const opp of opportunities) {
      try {
        if (!opp.rawHtml) continue;

        const $ = cheerio.load(opp.rawHtml);
        const scrapedData = this.extractData($, opp.sourceUrl!);
        const enrichData = this.buildEnrichmentData(scrapedData, opp.description);
        const isCancellation = scrapedData.isCancellation === true;

        await this.prisma.opportunity.update({
          where: { id: opp.id },
          data: {
            scrapedData: scrapedData as unknown as Prisma.InputJsonValue,
            scrapingStatus: ScrapingStatus.SUCCESS,
            scrapingError: null,
            ...enrichData,
          },
        });

        if (isCancellation) {
          await this.handleScrapingCancellation(opp.id);
        }

        const necoData = scrapedData.neco as NecoExtractedData | undefined;
        const totalLineItems = necoData?.totalLineItems || 0;

        processed++;
        if (Object.keys(enrichData).length > 0) enriched++;
        results.push({ id: opp.id, totalLineItems, success: true });
      } catch (err) {
        errors++;
        results.push({ id: opp.id, totalLineItems: 0, success: false, error: err.message });
        this.logger.error(`Reprocess error for ${opp.id}: ${err.message}`);
      }
    }

    this.logger.log(
      `Reprocess complete: ${processed} processed, ${enriched} enriched, ${errors} errors`,
    );

    return { processed, enriched, errors, results };
  }

  /**
   * Obtém estatísticas de scraping
   */
  async getStatistics(userId: string) {
    const stats = await this.prisma.opportunity.groupBy({
      by: ['scrapingStatus'],
      where: { userId },
      _count: {
        scrapingStatus: true,
      },
    });

    return {
      total: await this.prisma.opportunity.count({ where: { userId } }),
      byStatus: stats.reduce(
        (acc, item) => {
          acc[item.scrapingStatus || 'never_attempted'] = item._count.scrapingStatus;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }
}
