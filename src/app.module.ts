import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RolesModule } from './roles/roles.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GmailModule } from './gmail/gmail.module';
import { TemplatesModule } from './templates/templates.module';
import { ParsingModule } from './parsing/parsing.module';
import { FingerprintingModule } from './fingerprinting/fingerprinting.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { ScrapingModule } from './scraping/scraping.module';
import { QueuesModule } from './queues/queues.module';
import { AlertsModule } from './alerts/alerts.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { RfqsModule } from './rfqs/rfqs.module';
import { SyncSchedulerModule } from './sync-scheduler/sync-scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RolesModule,
    AuthModule,
    UsersModule,
    GmailModule,
    TemplatesModule,
    ParsingModule,
    FingerprintingModule,
    OpportunitiesModule,
    ScrapingModule,
    QueuesModule,
    AlertsModule,
    SuppliersModule,
    RfqsModule,
    SyncSchedulerModule,
  ],
})
export class AppModule {}
