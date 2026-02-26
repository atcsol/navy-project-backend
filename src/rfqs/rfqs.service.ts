import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GmailService } from '../gmail/gmail.service';
import { AlertsGateway } from '../alerts/alerts.gateway';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqItemDto } from './dto/update-rfq-item.dto';
import {
  CreateRfqEmailTemplateDto,
  UpdateRfqEmailTemplateDto,
} from './dto/create-rfq-email-template.dto';

@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    private prisma: PrismaService,
    private gmailService: GmailService,
    private alertsGateway: AlertsGateway,
  ) {}

  // =====================================================================
  // RFQ CRUD
  // =====================================================================

  async create(userId: string, dto: CreateRfqDto) {
    // Generate reference number
    const referenceNumber = await this.generateReferenceNumber(userId);

    const rfq = await this.prisma.rfq.create({
      data: {
        userId,
        gmailAccountId: dto.gmailAccountId,
        opportunityId: dto.opportunityId || null,
        title: dto.title,
        referenceNumber,
        emailSubject: dto.emailSubject,
        emailBody: dto.emailBody,
        opportunityData: (dto.opportunityData as Prisma.InputJsonValue) || Prisma.JsonNull,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        notes: dto.notes,
        status: 'rascunho',
        items: {
          create: dto.supplierIds.map((supplierId) => ({
            supplierId,
            status: 'pendente',
          })),
        },
      },
      include: {
        items: { include: { supplier: true } },
        opportunity: true,
      },
    });

    return rfq;
  }

  async findAll(
    options?: {
      status?: string;
      opportunityId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.RfqWhereInput = {};

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.opportunityId) {
      where.opportunityId = options.opportunityId;
    }

    if (options?.search) {
      where.OR = [
        { title: { contains: options.search } },
        { referenceNumber: { contains: options.search } },
      ];
    }

    return this.prisma.rfq.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { supplier: { select: { id: true, name: true, email: true } } },
        },
        opportunity: {
          select: { id: true, solicitationNumber: true, site: true, description: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const rfq = await this.prisma.rfq.findFirst({
      where: { id },
      include: {
        items: {
          include: { supplier: true },
          orderBy: { quotedPrice: 'asc' },
        },
        opportunity: true,
        gmailAccount: { select: { id: true, email: true } },
      },
    });

    if (!rfq) {
      throw new NotFoundException('Cotacao nao encontrada');
    }

    return rfq;
  }

  // =====================================================================
  // SEND RFQ EMAILS
  // =====================================================================

  async send(id: string) {
    const rfq = await this.findOne(id);

    if (rfq.status !== 'rascunho') {
      throw new BadRequestException('Apenas cotacoes em rascunho podem ser enviadas');
    }

    const results: Array<{ supplierId: string; success: boolean; error?: string }> = [];

    for (const item of rfq.items) {
      try {
        // Replace placeholders in email
        const opp = rfq.opportunity as { solicitationNumber?: string | null; nsn?: string | null; partNumber?: string | null; description?: string | null; quantity?: number | null } | null;
        const personalizedBody = this.replacePlaceholders(rfq.emailBody, {
          supplierName: item.supplier.name,
          solicitationNumber: opp?.solicitationNumber || '',
          nsn: opp?.nsn || '',
          partNumber: opp?.partNumber || '',
          description: opp?.description || '',
          quantity: String(opp?.quantity || ''),
          deadline: rfq.deadline ? rfq.deadline.toLocaleDateString('en-US') : '',
        });

        const personalizedSubject = this.replacePlaceholders(rfq.emailSubject, {
          supplierName: item.supplier.name,
          solicitationNumber: opp?.solicitationNumber || '',
          nsn: opp?.nsn || '',
          partNumber: opp?.partNumber || '',
          description: opp?.description || '',
          quantity: String(opp?.quantity || ''),
          deadline: rfq.deadline ? rfq.deadline.toLocaleDateString('en-US') : '',
        });

        const emailResult = await this.gmailService.sendEmail(
          rfq.gmailAccountId,
          {
            to: item.supplier.email,
            subject: personalizedSubject,
            htmlBody: personalizedBody,
          },
        );

        await this.prisma.rfqItem.update({
          where: { id: item.id },
          data: {
            emailMessageId: emailResult.messageId,
            emailThreadId: emailResult.threadId,
            sentAt: new Date(),
            status: 'enviado',
          },
        });

        results.push({ supplierId: item.supplierId, success: true });

        // Delay between sends to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        this.logger.error(
          `Failed to send RFQ email to ${item.supplier.email}: ${(error as Error).message}`,
        );

        await this.prisma.rfqItem.update({
          where: { id: item.id },
          data: { status: 'erro_envio' },
        });

        results.push({
          supplierId: item.supplierId,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    // Update RFQ status
    await this.prisma.rfq.update({
      where: { id },
      data: {
        status: 'enviada',
        sentAt: new Date(),
      },
    });

    return {
      rfqId: id,
      totalSent: results.filter((r) => r.success).length,
      totalFailed: results.filter((r) => !r.success).length,
      results,
    };
  }

  // =====================================================================
  // UPDATE RFQ ITEM (Preencher cotação manualmente)
  // =====================================================================

  async updateItem(
    rfqId: string,
    itemId: string,
    dto: UpdateRfqItemDto,
  ) {
    const rfq = await this.findOne(rfqId);
    const item = rfq.items.find((i) => i.id === itemId);

    if (!item) {
      throw new NotFoundException('Item da cotacao nao encontrado');
    }

    const updateData: Prisma.RfqItemUpdateInput = {};

    if (dto.quotedPrice !== undefined) updateData.quotedPrice = dto.quotedPrice;
    if (dto.quotedDeliveryDays !== undefined) updateData.quotedDeliveryDays = dto.quotedDeliveryDays;
    if (dto.quotedCondition !== undefined) updateData.quotedCondition = dto.quotedCondition;
    if (dto.quotedNotes !== undefined) updateData.quotedNotes = dto.quotedNotes;
    if (dto.isSelected !== undefined) {
      updateData.isSelected = dto.isSelected;
      // If selecting this item, deselect others
      if (dto.isSelected) {
        await this.prisma.rfqItem.updateMany({
          where: { rfqId, NOT: { id: itemId } },
          data: { isSelected: false },
        });
      }
    }

    // If price is being set, mark as quoted
    if (dto.quotedPrice !== undefined) {
      updateData.status = 'cotado';
      updateData.quotedAt = new Date();
    }

    const updated = await this.prisma.rfqItem.update({
      where: { id: itemId },
      data: updateData,
      include: { supplier: true },
    });

    // Check if all items have been quoted and update RFQ status
    await this.updateRfqStatusFromItems(rfqId);

    return updated;
  }

  // =====================================================================
  // FINALIZE / CANCEL
  // =====================================================================

  async finalize(id: string) {
    const rfq = await this.findOne(id);

    if (!['enviada', 'parcialmente_respondida', 'respondida'].includes(rfq.status)) {
      throw new BadRequestException('Cotacao nao pode ser finalizada neste status');
    }

    return this.prisma.rfq.update({
      where: { id },
      data: { status: 'finalizada' },
    });
  }

  async cancel(id: string) {
    const rfq = await this.findOne(id);

    if (['finalizada', 'cancelada'].includes(rfq.status)) {
      throw new BadRequestException('Cotacao ja esta finalizada ou cancelada');
    }

    return this.prisma.rfq.update({
      where: { id },
      data: { status: 'cancelada' },
    });
  }

  // =====================================================================
  // CHECK FOR RESPONSES (called from email-sync)
  // =====================================================================

  async checkForResponses(gmailAccountId: string) {
    const sentItems = await this.prisma.rfqItem.findMany({
      where: {
        status: 'enviado',
        emailThreadId: { not: null },
        rfq: { gmailAccountId },
      },
      include: {
        supplier: { select: { name: true } },
        rfq: { select: { id: true, title: true, userId: true } },
      },
    });

    let responsesFound = 0;

    for (const item of sentItems) {
      if (!item.emailThreadId || !item.emailMessageId) continue;

      try {
        const result = await this.gmailService.checkThreadForNewMessages(
          gmailAccountId,
          item.emailThreadId,
          item.emailMessageId,
        );

        if (result.hasNewMessages) {
          await this.prisma.rfqItem.update({
            where: { id: item.id },
            data: {
              status: 'resposta_recebida',
              respondedAt: new Date(),
            },
          });

          // Emit WebSocket notification
          this.alertsGateway.emitRfqResponse(item.rfq.userId, {
            rfqId: item.rfq.id,
            rfqItemId: item.id,
            supplierName: item.supplier.name,
            rfqTitle: item.rfq.title,
          });

          responsesFound++;

          // Update parent RFQ status
          await this.updateRfqStatusFromItems(item.rfqId);
        }
      } catch (error) {
        this.logger.error(
          `Failed to check thread ${item.emailThreadId}: ${(error as Error).message}`,
        );
      }
    }

    return { responsesFound };
  }

  // =====================================================================
  // EMAIL TEMPLATES
  // =====================================================================

  async findEmailTemplates() {
    return this.prisma.rfqEmailTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createEmailTemplate(userId: string, dto: CreateRfqEmailTemplateDto) {
    if (dto.isDefault) {
      // Unset other defaults
      await this.prisma.rfqEmailTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.rfqEmailTemplate.create({
      data: {
        userId,  // Still needed for DB record ownership
        name: dto.name,
        subject: dto.subject,
        body: dto.body,
        isDefault: dto.isDefault || false,
      },
    });
  }

  async updateEmailTemplate(
    id: string,
    dto: UpdateRfqEmailTemplateDto,
  ) {
    const template = await this.prisma.rfqEmailTemplate.findFirst({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Template de email nao encontrado');
    }

    if (dto.isDefault) {
      await this.prisma.rfqEmailTemplate.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }

    return this.prisma.rfqEmailTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });
  }

  async deleteEmailTemplate(id: string) {
    const template = await this.prisma.rfqEmailTemplate.findFirst({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Template de email nao encontrado');
    }

    await this.prisma.rfqEmailTemplate.delete({ where: { id } });
  }

  // =====================================================================
  // PRIVATE HELPERS
  // =====================================================================

  private async generateReferenceNumber(userId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.rfq.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });
    return `RFQ-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private replacePlaceholders(
    template: string,
    data: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }
    return result;
  }

  private async updateRfqStatusFromItems(rfqId: string) {
    const items = await this.prisma.rfqItem.findMany({
      where: { rfqId },
    });

    const sentItems = items.filter((i) =>
      ['enviado', 'resposta_recebida', 'cotado', 'sem_resposta'].includes(i.status),
    );
    const respondedItems = items.filter((i) =>
      ['resposta_recebida', 'cotado'].includes(i.status),
    );

    if (sentItems.length === 0) return;

    let newStatus: string | null = null;
    if (respondedItems.length === sentItems.length) {
      newStatus = 'respondida';
    } else if (respondedItems.length > 0) {
      newStatus = 'parcialmente_respondida';
    }

    if (newStatus) {
      const rfq = await this.prisma.rfq.findUnique({ where: { id: rfqId } });
      if (rfq && !['finalizada', 'cancelada'].includes(rfq.status)) {
        await this.prisma.rfq.update({
          where: { id: rfqId },
          data: { status: newStatus },
        });
      }
    }
  }
}
