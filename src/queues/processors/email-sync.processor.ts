import { Process, Processor } from '@nestjs/bull';
import { Logger, Inject, Optional } from '@nestjs/common';
import type { Job } from 'bull';
import type { ParsingTemplate } from '@prisma/client';
import { EmailSyncJob, QueuesService } from '../queues.service';
import { GmailService } from '../../gmail/gmail.service';
import { TemplatesService } from '../../templates/templates.service';
import { ParsingService, ParsedEmail } from '../../parsing/parsing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RfqsService } from '../../rfqs/rfqs.service';

interface TemplateWithConfig extends ParsingTemplate {
  webScrapingConfig?: { isEnabled: boolean } | null;
}

interface EmailSyncResult {
  success: boolean;
  templatesMatched: number;
  emailsFound: number;
  jobsEnqueued: number;
  errors: string[];
}

interface SyncProgress {
  step: string;
  templatesTotal: number;
  templatesProcessed: number;
  currentTemplate: string | null;
  emailsFound: number;
  emailsEnqueued: number;
  opportunityJobIds: string[];
  errors: string[];
}

@Processor('email-sync')
export class EmailSyncProcessor {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly queuesService: QueuesService,
    private readonly templatesService: TemplatesService,
    private readonly parsingService: ParsingService,
    private readonly prisma: PrismaService,
    @Optional() private readonly rfqsService?: RfqsService,
  ) {}

  @Process('sync-emails')
  async handleEmailSync(job: Job<EmailSyncJob>): Promise<EmailSyncResult> {
    const { userId, gmailAccountId, templateId, since } = job.data;

    const progress: SyncProgress = {
      step: 'loading_templates',
      templatesTotal: 0,
      templatesProcessed: 0,
      currentTemplate: null,
      emailsFound: 0,
      emailsEnqueued: 0,
      opportunityJobIds: [],
      errors: [],
    };

    await job.progress(progress);

    this.logger.log(
      `Starting email sync for user ${userId}, account ${gmailAccountId}` +
        (templateId ? `, template ${templateId}` : ''),
    );

    const templates = templateId
      ? [await this.templatesService.findOne(templateId, userId)]
      : await this.templatesService.findActive(userId);

    if (templates.length === 0) {
      this.logger.warn(`No active templates found for user ${userId}`);
      progress.step = 'completed';
      progress.errors.push('Nenhum template ativo configurado');
      await job.progress(progress);
      return {
        success: true,
        templatesMatched: 0,
        emailsFound: 0,
        jobsEnqueued: 0,
        errors: progress.errors,
      };
    }

    progress.templatesTotal = templates.length;
    progress.step = 'searching_emails';
    await job.progress(progress);

    for (const template of templates) {
      progress.currentTemplate = template.name;
      await job.progress(progress);

      try {
        await this.syncEmailsForTemplate(
          job,
          progress,
          userId,
          gmailAccountId,
          template,
          since,
        );
      } catch (error) {
        const err = error as Error;
        const message = `Template "${template.name}": ${err.message}`;
        this.logger.error(message, err.stack);
        progress.errors.push(message);
      }

      progress.templatesProcessed++;
      await job.progress(progress);
    }

    // Check for RFQ responses
    if (this.rfqsService) {
      progress.step = 'checking_rfq_responses';
      await job.progress(progress);
      try {
        const rfqResult = await this.rfqsService.checkForResponses(userId, gmailAccountId);
        if (rfqResult.responsesFound > 0) {
          this.logger.log(`Found ${rfqResult.responsesFound} RFQ response(s)`);
        }
      } catch (error) {
        this.logger.error(`Error checking RFQ responses: ${(error as Error).message}`);
        progress.errors.push(`RFQ response check: ${(error as Error).message}`);
      }
    }

    progress.step = 'updating_sync';
    await job.progress(progress);

    await this.updateLastSync(gmailAccountId);

    progress.step = 'completed';
    await job.progress(progress);

    this.logger.log(
      `Email sync completed: ${progress.emailsFound} found, ${progress.emailsEnqueued} enqueued, ${progress.errors.length} errors`,
    );

    return {
      success: progress.errors.length === 0,
      templatesMatched: templates.length,
      emailsFound: progress.emailsFound,
      jobsEnqueued: progress.emailsEnqueued,
      errors: progress.errors,
    };
  }

  private async syncEmailsForTemplate(
    job: Job<EmailSyncJob>,
    progress: SyncProgress,
    userId: string,
    gmailAccountId: string,
    template: TemplateWithConfig,
    since?: Date,
  ): Promise<void> {
    const query = this.buildGmailQuery(template, since);

    this.logger.debug(
      `Searching emails for template "${template.name}" with query: ${query}`,
    );

    const emails = await this.gmailService.listEmails(
      gmailAccountId,
      userId,
      { query, maxResults: 100 },
    );

    progress.emailsFound += emails.length;
    progress.step = 'processing_emails';
    await job.progress(progress);

    for (const emailMeta of emails) {
      const messageId = emailMeta.id;
      if (!messageId) continue;

      try {
        const parsedEmail: ParsedEmail = {
          subject: emailMeta.subject,
          from: emailMeta.from,
          date: new Date(emailMeta.date),
          body: '',
        };

        if (!this.parsingService.matchesTemplate(parsedEmail, template)) {
          continue;
        }

        const emailContent = await this.gmailService.getEmailContent(
          gmailAccountId,
          userId,
          messageId,
        );

        const oppJobId = await this.queuesService.addOpportunityProcessingJob({
          userId,
          gmailAccountId,
          emailMessageId: messageId,
          emailThreadId: emailMeta.threadId || messageId,
          emailDate: new Date(emailMeta.date),
          emailBody: emailContent.body,
          templateId: template.id,
        });

        progress.emailsEnqueued++;
        progress.opportunityJobIds.push(oppJobId);
        await job.progress(progress);
      } catch (error) {
        this.logger.error(
          `Failed to process email ${messageId}: ${(error as Error).message}`,
        );
        progress.errors.push(`Email ${messageId}: ${(error as Error).message}`);
      }
    }
  }

  private buildGmailQuery(template: TemplateWithConfig, since?: Date): string {
    const parts: string[] = [];

    // Se o template tem emailQuery customizada, usa ela como base
    if (template.emailQuery) {
      parts.push(template.emailQuery);
    } else {
      // Fallback: constrói query a partir de senderEmail e subjectFilter
      if (template.senderEmail) {
        parts.push(`from:${template.senderEmail}`);
      }

      if (template.subjectFilter) {
        parts.push(`subject:${template.subjectFilter}`);
      }
    }

    if (since) {
      const sinceDate = since instanceof Date ? since : new Date(since);
      const formatted = sinceDate.toISOString().split('T')[0].replace(/-/g, '/');
      parts.push(`after:${formatted}`);
    }

    return parts.join(' ');
  }

  private async updateLastSync(gmailAccountId: string): Promise<void> {
    await this.prisma.gmailAccount.update({
      where: { id: gmailAccountId },
      data: { lastSync: new Date() },
    });
  }
}
