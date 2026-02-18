import { Module, forwardRef } from '@nestjs/common';
import { RfqsService } from './rfqs.service';
import { RfqsController } from './rfqs.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { GmailModule } from '../gmail/gmail.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [PrismaModule, forwardRef(() => GmailModule), AlertsModule],
  controllers: [RfqsController],
  providers: [RfqsService],
  exports: [RfqsService],
})
export class RfqsModule {}
