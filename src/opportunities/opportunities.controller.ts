import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import { ChildOpportunitiesService } from './child-opportunities.service';
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { FindOpportunitiesQueryDto } from './dto/find-opportunities-query.dto';

@Controller('opportunities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
    private readonly childOpportunitiesService: ChildOpportunitiesService,
  ) {}

  @Post()
  @RequirePermission('opportunities.create')
  create(
    @CurrentUser() user: UserEntity,
    @Body() createOpportunityDto: CreateOpportunityDto,
  ) {
    return this.opportunitiesService.create(user.id, createOpportunityDto);
  }

  /**
   * Contagem por status (para badges das abas)
   * GET /api/opportunities/counts-by-status
   * IMPORTANTE: deve vir ANTES do :id para evitar conflito de rota
   */
  @Get('counts-by-status')
  @RequirePermission('opportunities.view')
  countsByStatus(@CurrentUser() user: UserEntity) {
    return this.opportunitiesService.countsByStatus(user.id);
  }

  @Get()
  @RequirePermission('opportunities.view')
  findAll(
    @CurrentUser() user: UserEntity,
    @Query() query: FindOpportunitiesQueryDto,
  ) {
    return this.opportunitiesService.findAll(
      user.id,
      query.page,
      query.limit,
      {
        status: query.status,
        site: query.site,
        templateId: query.templateId,
        search: query.search,
        closingBefore: query.closingBefore,
        closingAfter: query.closingAfter,
        includeDeleted: query.includeDeleted === 'true',
        includeExpired: query.includeExpired === 'true',
        quotationPhase: query.quotationPhase,
        purchaseStatus: query.purchaseStatus,
      },
    );
  }

  /**
   * Lista oportunidades filhas de um parent
   * GET /api/opportunities/:id/children
   */
  @Get(':id/children')
  @RequirePermission('opportunities.view')
  findChildren(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.childOpportunitiesService.findChildren(id, user.id);
  }

  @Get(':id')
  @RequirePermission('opportunities.view')
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.opportunitiesService.findOne(id, user.id);
  }

  @Patch(':id')
  @RequirePermission('opportunities.update')
  update(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() updateOpportunityDto: UpdateOpportunityDto,
  ) {
    return this.opportunitiesService.update(
      id,
      user.id,
      updateOpportunityDto,
    );
  }

  // =====================================================================
  // WORKFLOW ENDPOINTS
  // =====================================================================

  /**
   * Transição de status (com validação de máquina de estados)
   * PATCH /api/opportunities/:id/status
   */
  @Patch(':id/status')
  @RequirePermission('opportunities.update')
  transitionStatus(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: TransitionStatusDto,
  ) {
    return this.opportunitiesService.transitionStatus(id, user.id, dto);
  }

  /**
   * Alterar fase da cotação
   * PATCH /api/opportunities/:id/quotation-phase
   */
  @Patch(':id/quotation-phase')
  @RequirePermission('opportunities.update')
  updateQuotationPhase(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateQuotationPhaseDto,
  ) {
    return this.opportunitiesService.updateQuotationPhase(id, user.id, dto);
  }

  /**
   * Registrar dados do BID
   * PATCH /api/opportunities/:id/bid
   */
  @Patch(':id/bid')
  @RequirePermission('opportunities.update')
  updateBid(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateBidDto,
  ) {
    return this.opportunitiesService.updateBid(id, user.id, dto);
  }

  /**
   * Registrar resultado do BID (vencedora ou não)
   * PATCH /api/opportunities/:id/bid-result
   */
  @Patch(':id/bid-result')
  @RequirePermission('opportunities.update')
  updateBidResult(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateBidResultDto,
  ) {
    return this.opportunitiesService.updateBidResult(id, user.id, dto);
  }

  /**
   * Registrar dados de compra
   * PATCH /api/opportunities/:id/purchase
   */
  @Patch(':id/purchase')
  @RequirePermission('opportunities.update')
  updatePurchase(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.opportunitiesService.updatePurchase(id, user.id, dto);
  }

  /**
   * Registrar entrega
   * PATCH /api/opportunities/:id/delivery
   */
  @Patch(':id/delivery')
  @RequirePermission('opportunities.update')
  updateDelivery(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.opportunitiesService.updateDelivery(id, user.id, dto);
  }

  // =====================================================================
  // CRUD
  // =====================================================================

  @Delete(':id')
  @RequirePermission('opportunities.delete')
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.opportunitiesService.softDelete(id, user.id);
  }

  @Post(':id/restore')
  @RequirePermission('opportunities.update')
  restore(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.opportunitiesService.restore(id, user.id);
  }

  @Delete(':id/hard')
  @RequirePermission('opportunities.delete')
  hardDelete(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.opportunitiesService.hardDelete(id, user.id);
  }

  @Post('cleanup')
  @RequirePermission('opportunities.delete')
  cleanup(
    @CurrentUser() user: UserEntity,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    return this.opportunitiesService.cleanupOldDeleted(user.id, days || 30);
  }
}
