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
} from '@nestjs/common';
import { RfqsService } from './rfqs.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqItemDto } from './dto/update-rfq-item.dto';
import {
  CreateRfqEmailTemplateDto,
  UpdateRfqEmailTemplateDto,
} from './dto/create-rfq-email-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';

@Controller('rfqs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  // =====================================================================
  // EMAIL TEMPLATES (must come before :id routes)
  // =====================================================================

  @Get('email-templates')
  @RequirePermission('rfqs.view')
  findEmailTemplates(@CurrentUser() user: UserEntity) {
    return this.rfqsService.findEmailTemplates(user.id);
  }

  @Post('email-templates')
  @RequirePermission('rfqs.create')
  createEmailTemplate(
    @CurrentUser() user: UserEntity,
    @Body() dto: CreateRfqEmailTemplateDto,
  ) {
    return this.rfqsService.createEmailTemplate(user.id, dto);
  }

  @Patch('email-templates/:id')
  @RequirePermission('rfqs.update')
  updateEmailTemplate(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateRfqEmailTemplateDto,
  ) {
    return this.rfqsService.updateEmailTemplate(id, user.id, dto);
  }

  @Delete('email-templates/:id')
  @RequirePermission('rfqs.delete')
  deleteEmailTemplate(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.rfqsService.deleteEmailTemplate(id, user.id);
  }

  // =====================================================================
  // RFQ CRUD
  // =====================================================================

  @Post()
  @RequirePermission('rfqs.create')
  create(@CurrentUser() user: UserEntity, @Body() dto: CreateRfqDto) {
    return this.rfqsService.create(user.id, dto);
  }

  @Get()
  @RequirePermission('rfqs.view')
  findAll(
    @CurrentUser() user: UserEntity,
    @Query('status') status?: string,
    @Query('opportunityId') opportunityId?: string,
    @Query('search') search?: string,
  ) {
    return this.rfqsService.findAll(user.id, { status, opportunityId, search });
  }

  @Get(':id')
  @RequirePermission('rfqs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.rfqsService.findOne(id, user.id);
  }

  // =====================================================================
  // RFQ ACTIONS
  // =====================================================================

  @Post(':id/send')
  @RequirePermission('rfqs.send')
  send(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.rfqsService.send(id, user.id);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('rfqs.update')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateRfqItemDto,
  ) {
    return this.rfqsService.updateItem(id, itemId, user.id, dto);
  }

  @Post(':id/finalize')
  @RequirePermission('rfqs.update')
  finalize(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.rfqsService.finalize(id, user.id);
  }

  @Post(':id/cancel')
  @RequirePermission('rfqs.update')
  cancel(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.rfqsService.cancel(id, user.id);
  }
}
