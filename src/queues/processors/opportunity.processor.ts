import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import type { Job } from 'bull';
import type { Prisma, ParsingTemplate } from '@prisma/client';
import { OpportunityProcessingJob } from '../queues.service';
import { QueuesService } from '../queues.service';
import { ParsingService, ParsedEmail, ParsedOpportunity } from '../../parsing/parsing.service';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { TemplatesService } from '../../templates/templates.service';
import { FingerprintingService } from '../../fingerprinting/fingerprinting.service';
import { ScrapingService } from '../../scraping/scraping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertsGateway } from '../../alerts/alerts.gateway';
import { OutputSchema } from '../../templates/dto/create-template.dto';

interface TemplateWithWebScraping extends ParsingTemplate {
  webScrapingConfig?: { isEnabled: boolean } | null;
}

interface ProcessingResult {
  success: boolean;
  created: number;
  updated: number;
  duplicates: number;
  errors: number;
  cancellationsDetected: number;
  opportunityIds: string[];
  scrapingJobIds: string[];
}

@Processor('opportunity-processing')
export class OpportunityProcessorQueue {
  private readonly logger = new Logger(OpportunityProcessorQueue.name);

  constructor(
    private readonly parsingService: ParsingService,
    private readonly opportunitiesService: OpportunitiesService,
    private readonly templatesService: TemplatesService,
    private readonly fingerprintingService: FingerprintingService,
    private readonly scrapingService: ScrapingService,
    private readonly queuesService: QueuesService,
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService,
    private readonly alertsGateway: AlertsGateway,
  ) {}

  @Process('process-opportunity')
  async handleOpportunityProcessing(
    job: Job<OpportunityProcessingJob>,
  ): Promise<ProcessingResult> {
    const {
      userId,
      gmailAccountId,
      emailMessageId,
      emailThreadId,
      emailDate,
      emailBody,
      templateId,
    } = job.data;

    this.logger.log(`Processing email ${emailMessageId} for user ${userId}`);

    if (!templateId) {
      this.logger.error(`No templateId provided for email ${emailMessageId}`);
      return {
        success: false,
        created: 0,
        updated: 0,
        duplicates: 0,
        errors: 1,
        cancellationsDetected: 0,
        opportunityIds: [],
        scrapingJobIds: [],
      };
    }

    const template = await this.templatesService.findOne(templateId, userId) as unknown as TemplateWithWebScraping;
    const outputSchema = template.outputSchema as unknown as OutputSchema;
    const fieldMapping: Record<string, string> =
      outputSchema.fieldMapping || {};

    const webScrapingConfig = template.webScrapingConfig;
    const templateScrapingEnabled = webScrapingConfig?.isEnabled === true;

    // Verifica autoScrapeOnSync nas settings do usuário
    const userSettings = await this.scrapingService.getSettings(userId);
    const scrapingEnabled = templateScrapingEnabled || userSettings.autoScrapeOnSync;

    if (scrapingEnabled) {
      this.logger.log(`Scraping enabled for template ${templateId} (template=${templateScrapingEnabled}, autoScrape=${userSettings.autoScrapeOnSync})`);
    }

    const parsedEmail: ParsedEmail = {
      subject: '',
      from: '',
      date: new Date(emailDate),
      body: emailBody,
    };

    const parsedOpportunities = await this.parsingService.parseEmail(
      parsedEmail,
      template,
    );

    this.logger.log(
      `Parsed ${parsedOpportunities.length} opportunity(ies) from email ${emailMessageId}`,
    );

    if (parsedOpportunities.length > 0) {
      const sampleData = parsedOpportunities[0].data;
      const nonNullFields = Object.entries(sampleData)
        .filter(([, v]) => v != null)
        .map(([k]) => k);
      this.logger.log(
        `Extracted fields with values: [${nonNullFields.join(', ')}] (${nonNullFields.length}/${Object.keys(sampleData).length})`,
      );
    }

    const result: ProcessingResult = {
      success: true,
      created: 0,
      updated: 0,
      duplicates: 0,
      errors: 0,
      cancellationsDetected: 0,
      opportunityIds: [],
      scrapingJobIds: [],
    };

    for (let itemIndex = 0; itemIndex < parsedOpportunities.length; itemIndex++) {
      const parsed = parsedOpportunities[itemIndex];

      // Skip blank items (all extracted fields null - happens at end of multiline emails)
      const hasAnyData = Object.values(parsed.data).some(v => v != null);
      if (!hasAnyData) {
        this.logger.debug(`Skipping blank item from email ${emailMessageId} (all fields null)`);
        continue;
      }

      try {
        const mapped = this.mapExtractedFields(parsed.data, fieldMapping);

        // ============================================================
        // DETECÇÃO DE CANCELAMENTO
        // ============================================================
        const transPurpose = (
          mapped.transPurpose ||
          parsed.data.transPurpose ||
          ''
        )
          .toString()
          .trim()
          .toLowerCase();
        const quoteType = (
          mapped.quoteType ||
          parsed.data.quoteType ||
          ''
        )
          .toString()
          .trim()
          .toLowerCase();

        const isCancellation =
          transPurpose.includes('cancellation') &&
          quoteType.includes('amendment');

        if (isCancellation && mapped.solicitationNumber) {
          await this.handleCancellation(
            userId,
            mapped.solicitationNumber,
            parsed,
            emailMessageId,
          );
          result.cancellationsDetected++;

          // Registra fingerprint para não reprocessar este cancelamento
          await this.prisma.opportunityFingerprint
            .create({
              data: {
                userId,
                fingerprint: parsed.fingerprint,
                action: 'deleted',
              },
            })
            .catch(() => {});

          continue;
        }

        // ============================================================
        // VERIFICAR SE JÁ EXISTE (por email_message_id + solicitationNumber)
        // Se existe → atualizar extractedData e campos mapeados
        // Se não existe → criar nova oportunidade
        // ============================================================
        const existingOpportunity = await this.prisma.opportunity.findFirst({
          where: {
            userId,
            emailMessageId,
            deletedAt: null,
            // Para multiline, usar solicitationNumber para distinguir itens do mesmo email
            ...(mapped.solicitationNumber ? { solicitationNumber: mapped.solicitationNumber } : {}),
          },
        });

        if (existingOpportunity) {
          // ATUALIZAR oportunidade existente com novos dados do template
          // NÃO atualizar fingerprint — evita unique constraint violation em emails multiline
          const updateData: Record<string, any> = {
            extractedData: parsed.data,
          };

          // Se scraping já enriqueceu esta oportunidade, NÃO sobrescrever campos enriquecidos
          // O scraping tem dados mais precisos (vêm da página NECO, não do email)
          const wasScraped = existingOpportunity.scrapingStatus === 'success';

          // Atualizar campos mapeados (só se tiverem valor)
          if (mapped.solicitationNumber) updateData.solicitationNumber = mapped.solicitationNumber;
          if (mapped.site) updateData.site = mapped.site;
          if (mapped.sourceUrl) updateData.sourceUrl = mapped.sourceUrl;
          if (mapped.closingDate) {
            updateData.closingDate = mapped.closingDate instanceof Date
              ? mapped.closingDate
              : new Date(mapped.closingDate);
          }
          if (mapped.deliveryDate) {
            updateData.deliveryDate = mapped.deliveryDate instanceof Date
              ? mapped.deliveryDate
              : new Date(mapped.deliveryDate);
          }

          // Campos que o scraping pode enriquecer — só atualizar se NÃO foi scrapeado
          if (!wasScraped) {
            if (mapped.partNumber) updateData.partNumber = mapped.partNumber;
            if (mapped.manufacturer) updateData.manufacturer = mapped.manufacturer;
            if (mapped.description) updateData.description = mapped.description;
            if (mapped.nsn) updateData.nsn = mapped.nsn;
            if (mapped.condition) updateData.condition = mapped.condition;
            if (mapped.unit) updateData.unit = mapped.unit;
            if (mapped.quantity) updateData.quantity = Number(mapped.quantity);
          }

          try {
            await this.prisma.opportunity.update({
              where: { id: existingOpportunity.id },
              data: updateData,
            });
            result.updated++;
            result.opportunityIds.push(existingOpportunity.id);
            this.logger.debug(
              `Updated existing opportunity ${existingOpportunity.id} from email ${emailMessageId}`,
            );
          } catch (updateError) {
            this.logger.warn(
              `Failed to update opportunity ${existingOpportunity.id}: ${(updateError as Error).message}`,
            );
            result.errors++;
          }
          continue;
        }

        // Verificar fingerprint para emails novos (sem oportunidade existente)
        const fingerprintCheck =
          await this.fingerprintingService.checkFingerprint(
            userId,
            parsed.fingerprint,
          );

        if (fingerprintCheck.exists) {
          result.duplicates++;
          this.logger.debug(
            `Duplicate fingerprint: ${parsed.fingerprint.substring(0, 16)}...`,
          );
          continue;
        }

        this.logger.debug(
          `Field mapping result: ${JSON.stringify(Object.keys(mapped).filter((k) => mapped[k] != null))}`,
        );

        const opportunity = await this.opportunitiesService.create(userId, {
          emailMessageId,
          emailThreadId,
          emailDate: new Date(emailDate).toISOString(),
          fingerprint: parsed.fingerprint,
          templateId,
          gmailAccountId,
          solicitationNumber: mapped.solicitationNumber,
          site: mapped.site,
          sourceUrl: mapped.sourceUrl,
          partNumber: mapped.partNumber,
          manufacturer: mapped.manufacturer,
          description: mapped.description,
          nsn: mapped.nsn,
          condition: mapped.condition,
          unit: mapped.unit,
          quantity: mapped.quantity ? Number(mapped.quantity) : undefined,
          closingDate:
            mapped.closingDate instanceof Date
              ? mapped.closingDate.toISOString()
              : mapped.closingDate,
          deliveryDate:
            mapped.deliveryDate instanceof Date
              ? mapped.deliveryDate.toISOString()
              : mapped.deliveryDate,
          extractedData: parsed.data,
        });

        result.created++;
        result.opportunityIds.push(opportunity.id);

        // Verifica se a oportunidade ainda é válida (closingDate >= hoje)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const closingDate = mapped.closingDate ? new Date(mapped.closingDate) : null;
        const isExpired = closingDate && closingDate < today;

        if (scrapingEnabled && mapped.sourceUrl && !isExpired) {
          try {
            const scrapingJobId = await this.queuesService.addScrapingJob({
              opportunityId: opportunity.id,
              userId,
              templateId,
              sourceUrl: mapped.sourceUrl,
            });
            result.scrapingJobIds.push(scrapingJobId);
            this.logger.log(
              `Scraping job ${scrapingJobId} enqueued for opportunity ${opportunity.id}`,
            );
          } catch (scrapingError) {
            this.logger.warn(
              `Failed to enqueue scraping job for opportunity ${opportunity.id}: ${(scrapingError as Error).message}`,
            );
          }
        }
      } catch (error) {
        result.errors++;
        this.logger.error(
          `Failed to process opportunity from email ${emailMessageId}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Email ${emailMessageId}: ${result.created} created, ${result.updated} updated, ${result.duplicates} duplicates, ${result.errors} errors, ${result.cancellationsDetected} cancellations, ${result.scrapingJobIds.length} scraping jobs`,
    );

    return result;
  }

  /**
   * Lida com cancelamento detectado via email NECO
   */
  private async handleCancellation(
    userId: string,
    solicitationNumber: string,
    parsed: ParsedOpportunity,
    emailMessageId: string,
  ) {
    this.logger.warn(
      `CANCELLATION detected for ${solicitationNumber} in email ${emailMessageId}`,
    );

    // Busca oportunidade existente pelo solicitationNumber
    const existingOpportunity = await this.prisma.opportunity.findFirst({
      where: {
        solicitationNumber,
        deletedAt: null,
        status: { not: 'cancelada' },
      },
    });

    if (existingOpportunity) {
      // Atualiza status para cancelada
      const currentHistory =
        (existingOpportunity.statusHistory as Prisma.JsonArray) || [];
      const historyEntry = {
        from: existingOpportunity.status,
        to: 'cancelada',
        at: new Date().toISOString(),
        by: 'system',
        reason: `Cancelamento detectado automaticamente via email NECO (${emailMessageId})`,
      };

      await this.prisma.opportunity.update({
        where: { id: existingOpportunity.id },
        data: {
          status: 'cancelada',
          cancelledAt: new Date(),
          cancellationSource: 'email_auto',
          statusHistory: [...currentHistory, historyEntry],
        },
      });

      // Cria alerta persistido no banco
      const alert = await this.alertsService.createAlert({
        userId,
        opportunityId: existingOpportunity.id,
        type: 'cancellation',
        title: `CANCELAMENTO: ${solicitationNumber}`,
        message: `A solicitação ${solicitationNumber} foi CANCELADA pelo NECO (Amendment to Solicitation - Cancellation). Detectado automaticamente do email.`,
        metadata: {
          emailMessageId,
          previousStatus: existingOpportunity.status,
          transPurpose: parsed.data.transPurpose,
          quoteType: parsed.data.quoteType,
        },
      });

      // Emite via WebSocket em tempo real
      this.alertsGateway.emitCancellation(userId, {
        opportunityId: existingOpportunity.id,
        solicitationNumber,
      });
      this.alertsGateway.emitAlert(userId, alert);
      this.alertsGateway.emitOpportunityUpdate(userId, {
        opportunityId: existingOpportunity.id,
        action: 'status_changed',
      });

      this.logger.warn(
        `Opportunity ${existingOpportunity.id} (${solicitationNumber}) cancelled via email auto-detection`,
      );
    } else {
      this.logger.log(
        `Cancellation for ${solicitationNumber} - no existing opportunity found (may have been previously cancelled or not yet imported)`,
      );
    }
  }

  /**
   * Mapeia campos extraídos para campos do DTO
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapExtractedFields(
    data: Record<string, unknown>,
    fieldMapping: Record<string, string>,
  ): Record<string, any> {
    const mapped: Record<string, any> = {};

    const knownDtoFields = [
      'solicitationNumber',
      'site',
      'sourceUrl',
      'partNumber',
      'manufacturer',
      'description',
      'nsn',
      'condition',
      'unit',
      'quantity',
      'closingDate',
      'deliveryDate',
      'transPurpose',
      'quoteType',
    ];

    for (const [dtoField, extractedField] of Object.entries(fieldMapping)) {
      if (data[extractedField] != null) {
        mapped[dtoField] = data[extractedField];
      }
    }

    for (const dtoField of knownDtoFields) {
      if (mapped[dtoField] != null) continue;

      const dtoLower = dtoField.toLowerCase();
      for (const [extractedKey, extractedValue] of Object.entries(data)) {
        if (extractedValue == null) continue;
        const keyLower = extractedKey.toLowerCase();
        if (
          keyLower === dtoLower ||
          keyLower.endsWith(dtoLower) ||
          keyLower.includes(dtoLower)
        ) {
          mapped[dtoField] = extractedValue;
          break;
        }
      }
    }

    return mapped;
  }
}
