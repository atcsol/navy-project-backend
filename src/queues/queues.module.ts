import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailSyncProcessor } from './processors/email-sync.processor';
import { OpportunityProcessorQueue } from './processors/opportunity.processor';
import { ScrapingProcessorQueue } from './processors/scraping.processor';
import { GmailModule } from '../gmail/gmail.module';
import { ParsingModule } from '../parsing/parsing.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { TemplatesModule } from '../templates/templates.module';
import { FingerprintingModule } from '../fingerprinting/fingerprinting.module';
import { ScrapingModule } from '../scraping/scraping.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RfqsModule } from '../rfqs/rfqs.module';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      {
        name: 'email-sync',
      },
      {
        name: 'opportunity-processing',
      },
      {
        name: 'scraping',
        limiter: {
          max: 1,        // 1 job por vez
          duration: 5000, // a cada 5 segundos (12 req/min max)
        },
      },
    ),
    forwardRef(() => GmailModule),
    ParsingModule,
    OpportunitiesModule,
    forwardRef(() => TemplatesModule),
    FingerprintingModule,
    ScrapingModule,
    AlertsModule,
    forwardRef(() => RfqsModule),
  ],
  controllers: [QueuesController],
  providers: [
    EmailSyncProcessor,
    OpportunityProcessorQueue,
    ScrapingProcessorQueue,
    QueuesService,
  ],
  exports: [QueuesService, BullModule],
})
export class QueuesModule {}
