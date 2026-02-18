import { Module } from '@nestjs/common';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SyncSchedulerController } from './sync-scheduler.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [PrismaModule, QueuesModule],
  controllers: [SyncSchedulerController],
  providers: [SyncSchedulerService],
  exports: [SyncSchedulerService],
})
export class SyncSchedulerModule {}
