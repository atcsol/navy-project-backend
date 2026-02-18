import { Module, forwardRef } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';
import { GmailModule } from '../gmail/gmail.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => QueuesModule),
    forwardRef(() => GmailModule),
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
