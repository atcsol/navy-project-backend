import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { QueuesService } from '../queues/queues.service';
import { GmailService } from '../gmail/gmail.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';

@Controller('templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly queuesService: QueuesService,
    private readonly gmailService: GmailService,
  ) {}

  @Post()
  @RequirePermission('templates.create')
  create(
    @CurrentUser() user: UserEntity,
    @Body() createTemplateDto: CreateTemplateDto,
  ) {
    return this.templatesService.create(user.id, createTemplateDto);
  }

  @Get()
  @RequirePermission('templates.view')
  findAll() {
    return this.templatesService.findAll();
  }

  @Get('active')
  @RequirePermission('templates.view')
  findActive() {
    return this.templatesService.findActive();
  }

  @Get(':id')
  @RequirePermission('templates.view')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('templates.update')
  update(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() updateTemplateDto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, updateTemplateDto);
  }

  @Delete(':id')
  @RequirePermission('templates.delete')
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.templatesService.remove(id);
  }

  /**
   * Sincroniza emails usando este template em todas as contas Gmail ativas
   * POST /api/templates/:id/sync
   */
  @Post(':id/sync')
  @RequirePermission('templates.update')
  async syncTemplate(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    const template = await this.templatesService.findOne(id);
    const accounts = await this.gmailService.findAllByUser();
    const activeAccounts = accounts.filter((a) => a.isActive);

    if (activeAccounts.length === 0) {
      return {
        message: 'Nenhuma conta Gmail ativa encontrada',
        jobIds: [],
      };
    }

    const jobIds = await Promise.all(
      activeAccounts.map((account) =>
        this.queuesService.addEmailSyncJob(
          user.id,
          account.id,
          account.lastSync || undefined,
          template.id,
        ),
      ),
    );

    return {
      message: `Sincronização iniciada em ${activeAccounts.length} conta(s) Gmail`,
      jobIds,
      templateId: template.id,
      templateName: template.name,
    };
  }
}
