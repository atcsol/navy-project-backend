import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FingerprintingService } from '../fingerprinting/fingerprinting.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import {
  UpdateOpportunityDto,
  TransitionStatusDto,
  UpdateQuotationPhaseDto,
  UpdateBidDto,
  UpdateBidResultDto,
  UpdatePurchaseDto,
  UpdateDeliveryDto,
} from './dto/update-opportunity.dto';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AlertsGateway } from '../alerts/alerts.gateway';
import {
  OpportunityStatus,
  QuotationPhase,
  PurchaseStatus,
  UrgencyLevel,
  VALID_TRANSITIONS,
  URGENCY_THRESHOLDS,
} from '../common/constants/opportunity.constants';
import { DEFAULT_PROFIT_MARGIN } from '../common/constants/app.constants';
import { findOrThrow } from '../common/helpers/prisma.helpers';
import {
  appendStatusHistory,
  createHistoryEntry,
} from '../common/helpers/status-history.helper';

export interface ListFilters {
  status?: string;
  site?: string;
  templateId?: string;
  search?: string;
  closingBefore?: string;
  closingAfter?: string;
  includeDeleted?: boolean;
  includeExpired?: boolean;
  quotationPhase?: string;
  purchaseStatus?: string;
}

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  /** Teto de segurança de linhas no export (evita estourar memória) */
  private static readonly EXPORT_MAX_ROWS = 50000;

  /**
   * Status que permanecem visíveis na listagem MESMO após a data de fechamento
   * passar. Uma vez que a proposta entra em cotação / vai ao BID, o fluxo de
   * trabalho continua após o closing (resultado, compra, entrega) — não deve sumir.
   * Só os status "iniciais" (nao_analisada, analisada, descartada) somem ao vencer.
   */
  private static readonly VISIBLE_AFTER_CLOSING = [
    OpportunityStatus.EM_COTACAO,
    OpportunityStatus.LANCADA_BID,
    OpportunityStatus.VENCEDORA_BID,
    OpportunityStatus.NAO_VENCEDORA,
  ];

  /**
   * Colunas trazidas na listagem. NÃO inclui rawHtml (LongText, página NECO
   * inteira), extractedData nem statusHistory — blobs pesados que tornavam o
   * findMany lento (vários MB por página). scrapedData é mantido pois a tabela
   * usa vendorCode/leadTimeDays na aba padrão.
   */
  private static readonly LIST_SELECT = {
    id: true,
    solicitationNumber: true,
    site: true,
    sourceUrl: true,
    partNumber: true,
    manufacturer: true,
    description: true,
    nsn: true,
    condition: true,
    unit: true,
    quantity: true,
    closingDate: true,
    deliveryDate: true,
    daysUntilClosing: true,
    urgencyLevel: true,
    maxPrice: true,
    purchasePrice: true,
    profitMargin: true,
    offeredPrice: true,
    profitAmount: true,
    wonPrice: true,
    bidPrice: true,
    status: true,
    quotationPhase: true,
    purchaseStatus: true,
    supplierName: true,
    purchaseDate: true,
    expectedDelivery: true,
    actualDelivery: true,
    deliveryOnTime: true,
    bidSubmittedAt: true,
    bidResultAt: true,
    cancelledAt: true,
    cancellationSource: true,
    isViewed: true,
    notes: true,
    scrapedData: true,
    scrapingStatus: true,
    parentOpportunityId: true,
    childrenCount: true,
    templateId: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.OpportunitySelect;

  /**
   * Select do EXPORT — só as colunas (escalares) que vão para o Excel.
   * NÃO inclui scrapedData (JSON grande) nem nenhum blob, para o export de
   * milhares de linhas ficar leve e não travar (payload pequeno + sem sort pesado).
   */
  private static readonly EXPORT_SELECT = {
    id: true,
    solicitationNumber: true,
    site: true,
    description: true,
    nsn: true,
    partNumber: true,
    manufacturer: true,
    condition: true,
    unit: true,
    quantity: true,
    purchasePrice: true,
    profitMargin: true,
    offeredPrice: true,
    profitAmount: true,
    wonPrice: true,
    bidPrice: true,
    closingDate: true,
    deliveryDate: true,
    urgencyLevel: true,
    status: true,
    quotationPhase: true,
    purchaseStatus: true,
    supplierName: true,
    sourceUrl: true,
  } satisfies Prisma.OpportunitySelect;

  constructor(
    private prisma: PrismaService,
    private fingerprintingService: FingerprintingService,
    private alertsGateway: AlertsGateway,
  ) {}

  /**
   * Busca oportunidade ativa (não deletada) ou lança 404
   */
  private findActiveOrThrow(id: string) {
    return findOrThrow(
      () =>
        this.prisma.opportunity.findFirst({
          where: { id, deletedAt: null },
        }),
      'Opportunity not found',
    );
  }

  /**
   * Cria uma nova oportunidade
   */
  async create(userId: string, createDto: CreateOpportunityDto) {
    const fingerprintCheck =
      await this.fingerprintingService.checkFingerprint(
        userId,
        createDto.fingerprint,
      );

    if (fingerprintCheck.exists) {
      this.logger.warn(
        `Duplicate fingerprint detected: ${createDto.fingerprint.substring(0, 16)}... (action: ${fingerprintCheck.action})`,
      );
      throw new ConflictException(
        `Opportunity already exists or was ${fingerprintCheck.action}`,
      );
    }

    const daysUntilClosing = createDto.closingDate
      ? this.calculateDaysUntilClosing(new Date(createDto.closingDate))
      : null;

    const urgencyLevel = daysUntilClosing
      ? this.calculateUrgency(daysUntilClosing)
      : null;

    const opportunity = await this.prisma.opportunity.create({
      data: {
        userId,
        templateId: createDto.templateId,
        gmailAccountId: createDto.gmailAccountId,
        emailMessageId: createDto.emailMessageId,
        emailThreadId: createDto.emailThreadId,
        emailDate: new Date(createDto.emailDate),
        fingerprint: createDto.fingerprint,
        solicitationNumber: createDto.solicitationNumber,
        site: createDto.site,
        sourceUrl: createDto.sourceUrl,
        partNumber: createDto.partNumber,
        manufacturer: createDto.manufacturer,
        description: createDto.description,
        nsn: createDto.nsn,
        condition: createDto.condition,
        unit: createDto.unit,
        quantity: createDto.quantity,
        closingDate: createDto.closingDate
          ? new Date(createDto.closingDate)
          : null,
        deliveryDate: createDto.deliveryDate
          ? new Date(createDto.deliveryDate)
          : null,
        daysUntilClosing,
        urgencyLevel,
        extractedData: createDto.extractedData as unknown as Prisma.InputJsonValue,
        status: OpportunityStatus.NAO_ANALISADA,
        profitMargin: new Decimal(DEFAULT_PROFIT_MARGIN),
      },
    });

    await this.fingerprintingService.recordFingerprint(
      userId,
      opportunity.id,
      createDto.fingerprint,
    );

    this.logger.log(`Opportunity created: ${opportunity.id}`);
    return opportunity;
  }

  /**
   * Monta o filtro `where` compartilhado entre a listagem e o export, garantindo
   * que ambos apliquem exatamente as mesmas regras (soft delete, expiração,
   * visibilidade pós-BID, busca, etc).
   */
  private buildListWhere(filters?: ListFilters): Prisma.OpportunityWhereInput {
    const where: Prisma.OpportunityWhereInput = {
      parentOpportunityId: null, // Filhas não aparecem na listagem principal
    };

    if (!filters?.includeDeleted) {
      where.deletedAt = null;
    }

    if (filters?.status === 'expirada') {
      // Aba "Expiradas": closingDate no passado. Exclui status pós-cotação/BID,
      // que continuam visíveis nas suas próprias abas mesmo após o fechamento.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      where.closingDate = { lt: today };
      where.status = { notIn: OpportunitiesService.VISIBLE_AFTER_CLOSING };
    } else if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.site) {
      where.site = filters.site;
    }

    if (filters?.templateId) {
      where.templateId = filters.templateId;
    }

    if (filters?.quotationPhase) {
      where.quotationPhase = filters.quotationPhase;
    }

    if (filters?.purchaseStatus) {
      where.purchaseStatus = filters.purchaseStatus;
    }

    const andConditions: Prisma.OpportunityWhereInput[] = [];

    if (filters?.search) {
      andConditions.push({
        OR: [
          { solicitationNumber: { contains: filters.search } },
          { description: { contains: filters.search } },
          { nsn: { contains: filters.search } },
          { partNumber: { contains: filters.search } },
        ],
      });
    }

    if (filters?.closingBefore || filters?.closingAfter) {
      const closingDateFilter: { lte?: Date; gte?: Date } = {};
      if (filters?.closingBefore) {
        closingDateFilter.lte = new Date(filters.closingBefore);
      }
      if (filters?.closingAfter) {
        closingDateFilter.gte = new Date(filters.closingAfter);
      }
      where.closingDate = closingDateFilter;
    }

    if (!filters?.includeExpired && filters?.status !== 'expirada') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      andConditions.push({
        OR: [
          { closingDate: null },
          { closingDate: { gte: today } },
          // Propostas já em cotação/BID/vencedoras continuam visíveis após o fechamento
          { status: { in: OpportunitiesService.VISIBLE_AFTER_CLOSING } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return where;
  }

  // Ordenação padrão da listagem/export
  private static readonly LIST_ORDER_BY: Prisma.OpportunityOrderByWithRelationInput[] = [
    { closingDate: { sort: 'asc', nulls: 'last' } },
    { createdAt: 'desc' },
  ];

  /**
   * Busca, na ordem, as linhas completas (LIST_SELECT) a partir de uma lista de ids.
   * Usado pelo padrão "deferred join": primeiro ordena/pagina trazendo só ids
   * (sort barato), depois hidrata as colunas pesadas só das linhas da página.
   * Isso evita o erro MySQL 1038 (Out of sort memory) que ocorre quando o
   * filesort empacota colunas grandes (scrapedData/description/notes) de milhares
   * de linhas no sort buffer.
   */
  private async hydrateByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.opportunity.findMany({
      where: { id: { in: ids } },
      select: OpportunitiesService.LIST_SELECT,
    });
    // O IN não preserva a ordem — reordena conforme os ids ordenados
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => Boolean(r));
  }

  /**
   * Lista oportunidades com paginação e filtros
   */
  async findAll(page: number = 1, limit: number = 50, filters?: ListFilters) {
    const skip = (page - 1) * limit;
    const where = this.buildListWhere(filters);

    // 1) Ordena/pagina trazendo só ids (filesort leve — não estoura o sort buffer)
    const [total, ordered] = await Promise.all([
      this.prisma.opportunity.count({ where }),
      this.prisma.opportunity.findMany({
        where,
        skip,
        take: limit,
        select: { id: true },
        orderBy: OpportunitiesService.LIST_ORDER_BY,
      }),
    ]);

    // 2) Hidrata as colunas completas só das linhas da página
    const opportunities = await this.hydrateByIds(ordered.map((o) => o.id));

    return {
      data: opportunities,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retorna TODAS as oportunidades que batem com os filtros (sem paginação de 100),
   * para exportação. Aplica as mesmas regras da listagem via buildListWhere.
   * Limitado a EXPORT_MAX_ROWS por segurança.
   */
  async exportAll(filters?: ListFilters) {
    const where = this.buildListWhere(filters);

    // 1) ids ordenados (sort leve), limitado ao teto
    const [total, ordered] = await Promise.all([
      this.prisma.opportunity.count({ where }),
      this.prisma.opportunity.findMany({
        where,
        take: OpportunitiesService.EXPORT_MAX_ROWS,
        select: { id: true },
        orderBy: OpportunitiesService.LIST_ORDER_BY,
      }),
    ]);

    // 2) hidrata em lotes só com EXPORT_SELECT (sem scrapedData) — payload leve
    const ids = ordered.map((o) => o.id);
    const CHUNK = 2000;
    type ExportRow = Prisma.OpportunityGetPayload<{ select: typeof OpportunitiesService.EXPORT_SELECT }>;
    const data: ExportRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const rows = await this.prisma.opportunity.findMany({
        where: { id: { in: slice } },
        select: OpportunitiesService.EXPORT_SELECT,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of slice) {
        const r = byId.get(id);
        if (r) data.push(r);
      }
    }

    return {
      data,
      meta: {
        total,
        returned: data.length,
        capped: total > OpportunitiesService.EXPORT_MAX_ROWS,
        maxRows: OpportunitiesService.EXPORT_MAX_ROWS,
      },
    };
  }

  /**
   * Busca uma oportunidade específica
   */
  async findOne(id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        template: true,
        gmailAccount: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }

    if (!opportunity.isViewed) {
      await this.prisma.opportunity.update({
        where: { id },
        data: {
          isViewed: true,
          viewedAt: new Date(),
        },
      });
    }

    return opportunity;
  }

  /**
   * Atualiza uma oportunidade (incluindo cálculos financeiros)
   */
  async update(id: string, updateDto: UpdateOpportunityDto) {
    await this.findOne(id);

    let offeredPrice: Decimal | undefined;
    let profitAmount: Decimal | undefined;

    const purchasePrice = updateDto.purchasePrice;
    const profitMargin = updateDto.profitMargin;

    if (purchasePrice !== undefined) {
      const margin =
        profitMargin !== undefined
          ? profitMargin
          : DEFAULT_PROFIT_MARGIN;

      offeredPrice = new Decimal(purchasePrice).mul(
        new Decimal(1).add(new Decimal(margin).div(100)),
      );
      profitAmount = offeredPrice.sub(new Decimal(purchasePrice));
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: {
        purchasePrice: updateDto.purchasePrice
          ? new Decimal(updateDto.purchasePrice)
          : undefined,
        profitMargin: updateDto.profitMargin
          ? new Decimal(updateDto.profitMargin)
          : undefined,
        wonPrice: updateDto.wonPrice
          ? new Decimal(updateDto.wonPrice)
          : undefined,
        offeredPrice,
        profitAmount,
        status: updateDto.status,
        isViewed: updateDto.isViewed,
        notes: updateDto.notes,
      },
    });
  }

  // =====================================================================
  // WORKFLOW: Transição de Status
  // =====================================================================

  /**
   * Transição de status com validação de máquina de estados
   */
  async transitionStatus(
    id: string,
    userId: string, // usado apenas para historyEntry
    dto: TransitionStatusDto,
  ) {
    const opportunity = await this.findActiveOrThrow(id);

    const currentStatus = opportunity.status as OpportunityStatus;
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowedTransitions.includes(dto.toStatus as OpportunityStatus)) {
      throw new BadRequestException(
        `Transição inválida: ${currentStatus} → ${dto.toStatus}. Transições permitidas: ${allowedTransitions.join(', ') || 'nenhuma'}`,
      );
    }

    const historyEntry = createHistoryEntry(currentStatus, dto.toStatus, userId, dto.reason);

    const updateData: Prisma.OpportunityUpdateInput = {
      status: dto.toStatus,
      statusHistory: appendStatusHistory(opportunity.statusHistory, historyEntry),
    };

    // Setups automáticos por status
    if (dto.toStatus === OpportunityStatus.EM_COTACAO && !opportunity.quotationPhase) {
      updateData.quotationPhase = QuotationPhase.ENVIADA;
    }

    if (dto.toStatus === OpportunityStatus.VENCEDORA_BID && !opportunity.purchaseStatus) {
      updateData.purchaseStatus = PurchaseStatus.PENDENTE;
    }

    if (dto.toStatus === OpportunityStatus.CANCELADA) {
      updateData.cancelledAt = new Date();
      updateData.cancellationSource = 'manual';
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: updateData,
    });

    // Criar alerta de mudança de status
    await this.prisma.opportunityAlert.create({
      data: {
        userId: opportunity.userId,
        opportunityId: id,
        type: dto.toStatus === OpportunityStatus.CANCELADA ? 'cancellation' : 'status_change',
        title:
          dto.toStatus === OpportunityStatus.CANCELADA
            ? `Proposta cancelada: ${opportunity.solicitationNumber || id}`
            : `Status alterado: ${opportunity.solicitationNumber || id}`,
        message:
          dto.toStatus === OpportunityStatus.CANCELADA
            ? `A proposta ${opportunity.solicitationNumber} foi cancelada manualmente.`
            : `Status alterado de "${currentStatus}" para "${dto.toStatus}".`,
        metadata: historyEntry,
      },
    });

    this.logger.log(
      `Status transition: ${currentStatus} → ${dto.toStatus} for opportunity ${id}`,
    );

    // Emitir via WebSocket
    this.alertsGateway.emitOpportunityUpdate(opportunity.userId, {
      opportunityId: id,
      action: 'status_changed',
      opportunity: updated,
    });

    // Atualizar contagens em tempo real
    const counts = await this.countsByStatus();
    this.alertsGateway.emitCountsUpdate(opportunity.userId, counts);

    return updated;
  }

  // =====================================================================
  // WORKFLOW: Fase da Cotação
  // =====================================================================

  async updateQuotationPhase(
    id: string,
    dto: UpdateQuotationPhaseDto,
  ) {
    const opportunity = await this.findActiveOrThrow(id);

    if (opportunity.status !== OpportunityStatus.EM_COTACAO) {
      throw new BadRequestException(
        'Só é possível alterar fase de cotação quando status é "em_cotacao"',
      );
    }

    if (!Object.values(QuotationPhase).includes(dto.phase as QuotationPhase)) {
      throw new BadRequestException(
        `Fase inválida: ${dto.phase}. Valores: ${Object.values(QuotationPhase).join(', ')}`,
      );
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: { quotationPhase: dto.phase },
    });
  }

  // =====================================================================
  // WORKFLOW: BID
  // =====================================================================

  async updateBid(id: string, userId: string, dto: UpdateBidDto) { // userId para historyEntry
    const opportunity = await this.findActiveOrThrow(id);

    if (
      opportunity.status !== OpportunityStatus.LANCADA_BID &&
      opportunity.status !== OpportunityStatus.EM_COTACAO
    ) {
      throw new BadRequestException(
        'Só é possível registrar dados do BID quando status é "em_cotacao" ou "lancada_bid"',
      );
    }

    const updateData: Prisma.OpportunityUpdateInput = {};

    if (dto.bidPrice !== undefined) {
      updateData.bidPrice = new Decimal(dto.bidPrice);
    }
    if (dto.bidSubmittedAt) {
      updateData.bidSubmittedAt = new Date(dto.bidSubmittedAt);
    }
    if (dto.bidNotes !== undefined) {
      updateData.bidNotes = dto.bidNotes;
    }

    // Auto-transição para lancada_bid se estava em em_cotacao
    if (opportunity.status === OpportunityStatus.EM_COTACAO) {
      updateData.status = OpportunityStatus.LANCADA_BID;
      updateData.statusHistory = appendStatusHistory(
        opportunity.statusHistory,
        createHistoryEntry(OpportunityStatus.EM_COTACAO, OpportunityStatus.LANCADA_BID, userId, 'BID registrado'),
      );
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: updateData,
    });
  }

  async updateBidResult(
    id: string,
    userId: string,
    dto: UpdateBidResultDto,
  ) {
    const opportunity = await this.findActiveOrThrow(id);

    if (opportunity.status !== OpportunityStatus.LANCADA_BID) {
      throw new BadRequestException(
        'Só é possível registrar resultado do BID quando status é "lancada_bid"',
      );
    }

    const historyEntry = createHistoryEntry(
      OpportunityStatus.LANCADA_BID,
      dto.result,
      userId,
      'Resultado do BID',
    );

    const updateData: Prisma.OpportunityUpdateInput = {
      status: dto.result,
      bidResultAt: dto.bidResultAt ? new Date(dto.bidResultAt) : new Date(),
      statusHistory: appendStatusHistory(opportunity.statusHistory, historyEntry),
    };

    if (dto.wonPrice !== undefined) {
      updateData.wonPrice = new Decimal(dto.wonPrice);
    }

    if (dto.bidNotes !== undefined) {
      updateData.bidNotes = dto.bidNotes;
    }

    // Se vencedora, inicializa purchase tracking
    if (dto.result === OpportunityStatus.VENCEDORA_BID) {
      updateData.purchaseStatus = PurchaseStatus.PENDENTE;
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: updateData,
    });

    // Alerta de resultado do BID
    const alert = await this.prisma.opportunityAlert.create({
      data: {
        userId: opportunity.userId,
        opportunityId: id,
        type: 'status_change',
        title:
          dto.result === OpportunityStatus.VENCEDORA_BID
            ? `Proposta VENCEDORA: ${opportunity.solicitationNumber || id}`
            : `Proposta não vencedora: ${opportunity.solicitationNumber || id}`,
        message:
          dto.result === OpportunityStatus.VENCEDORA_BID
            ? `A proposta ${opportunity.solicitationNumber} foi VENCEDORA no BID!`
            : `A proposta ${opportunity.solicitationNumber} não venceu o BID.`,
        metadata: historyEntry,
      },
    });

    // WebSocket
    this.alertsGateway.emitAlert(opportunity.userId, alert);
    this.alertsGateway.emitOpportunityUpdate(opportunity.userId, {
      opportunityId: id,
      action: 'status_changed',
      opportunity: updated,
    });
    const counts = await this.countsByStatus();
    this.alertsGateway.emitCountsUpdate(opportunity.userId, counts);

    return updated;
  }

  // =====================================================================
  // WORKFLOW: Compra e Entrega
  // =====================================================================

  async updatePurchase(
    id: string,
    dto: UpdatePurchaseDto,
  ) {
    const opportunity = await this.findActiveOrThrow(id);

    if (opportunity.status !== OpportunityStatus.VENCEDORA_BID) {
      throw new BadRequestException(
        'Só é possível gerenciar compra quando status é "vencedora_bid"',
      );
    }

    const updateData: Prisma.OpportunityUpdateInput = {};

    if (dto.supplierName !== undefined) updateData.supplierName = dto.supplierName;
    if (dto.supplierContact !== undefined) updateData.supplierContact = dto.supplierContact;
    if (dto.purchaseOrderNo !== undefined) updateData.purchaseOrderNo = dto.purchaseOrderNo;
    if (dto.purchaseDate) updateData.purchaseDate = new Date(dto.purchaseDate);
    if (dto.expectedDelivery) updateData.expectedDelivery = new Date(dto.expectedDelivery);
    if (dto.purchasePrice !== undefined) {
      updateData.purchasePrice = new Decimal(dto.purchasePrice);
    }

    if (dto.purchaseStatus) {
      if (!Object.values(PurchaseStatus).includes(dto.purchaseStatus as PurchaseStatus)) {
        throw new BadRequestException(
          `Status de compra inválido: ${dto.purchaseStatus}. Valores: ${Object.values(PurchaseStatus).join(', ')}`,
        );
      }
      updateData.purchaseStatus = dto.purchaseStatus;
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: updateData,
    });
  }

  async updateDelivery(
    id: string,
    dto: UpdateDeliveryDto,
  ) {
    const opportunity = await this.findActiveOrThrow(id);

    if (opportunity.status !== OpportunityStatus.VENCEDORA_BID) {
      throw new BadRequestException(
        'Só é possível registrar entrega quando status é "vencedora_bid"',
      );
    }

    const updateData: Prisma.OpportunityUpdateInput = {
      purchaseStatus: PurchaseStatus.ENTREGUE,
    };

    if (dto.actualDelivery) {
      updateData.actualDelivery = new Date(dto.actualDelivery);
    } else {
      updateData.actualDelivery = new Date();
    }

    if (dto.deliveryOnTime !== undefined) {
      updateData.deliveryOnTime = dto.deliveryOnTime;
    } else if (opportunity.expectedDelivery && updateData.actualDelivery) {
      // Auto-calcula se entregou no prazo
      updateData.deliveryOnTime =
        updateData.actualDelivery <= opportunity.expectedDelivery;
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: updateData,
    });
  }

  // =====================================================================
  // CONTAGENS POR STATUS (para badges das abas)
  // =====================================================================

  async countsByStatus() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [counts, expiredCount] = await Promise.all([
      this.prisma.opportunity.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          parentOpportunityId: null,
          OR: [
            { closingDate: null },
            { closingDate: { gte: today } },
            // Mesma regra da listagem: pós-cotação/BID conta mesmo vencido
            { status: { in: OpportunitiesService.VISIBLE_AFTER_CLOSING } },
          ],
        },
        _count: { status: true },
      }),
      this.prisma.opportunity.count({
        where: {
          deletedAt: null,
          parentOpportunityId: null,
          closingDate: { lt: today },
          // Não conta como "expirada" o que segue visível na sua própria aba
          status: { notIn: OpportunitiesService.VISIBLE_AFTER_CLOSING },
        },
      }),
    ]);

    const result: Record<string, number> = Object.fromEntries(
      Object.values(OpportunityStatus).map((s) => [s, 0]),
    );

    for (const item of counts) {
      result[item.status] = item._count.status;
    }

    result['expirada'] = expiredCount;

    return result;
  }

  // =====================================================================
  // CRUD existente
  // =====================================================================

  async softDelete(id: string) {
    const opportunity = await this.findOne(id);

    await this.fingerprintingService.updateFingerprintAction(
      opportunity.userId,
      id,
      'deleted',
    );

    return this.prisma.opportunity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    await findOrThrow(
      () => this.prisma.opportunity.findFirst({ where: { id } }),
      'Opportunity not found',
    );

    return this.prisma.opportunity.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async hardDelete(id: string) {
    const opportunity = await this.findOne(id);

    await this.fingerprintingService.removeFingerprintRecord(opportunity.userId, id);

    await this.prisma.opportunity.delete({
      where: { id },
    });

    this.logger.warn(`Opportunity hard deleted: ${id}`);
  }

  async cleanupOldDeleted(olderThanDays: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.opportunity.deleteMany({
      where: {
        deletedAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Cleaned up ${result.count} opportunities deleted more than ${olderThanDays} days ago`,
    );

    return result.count;
  }

  // =====================================================================
  // HELPERS
  // =====================================================================

  private calculateDaysUntilClosing(closingDate: Date): number {
    const now = new Date();
    const diff = closingDate.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  private calculateUrgency(daysUntilClosing: number): UrgencyLevel {
    if (daysUntilClosing < 0) return UrgencyLevel.EXPIRED;
    if (daysUntilClosing <= URGENCY_THRESHOLDS.critical) return UrgencyLevel.CRITICAL;
    if (daysUntilClosing <= URGENCY_THRESHOLDS.high) return UrgencyLevel.HIGH;
    if (daysUntilClosing <= URGENCY_THRESHOLDS.medium) return UrgencyLevel.MEDIUM;
    return UrgencyLevel.LOW;
  }
}
