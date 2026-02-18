import { Module } from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import { ChildOpportunitiesService } from './child-opportunities.service';
import { OpportunitiesController } from './opportunities.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { FingerprintingModule } from '../fingerprinting/fingerprinting.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [PrismaModule, FingerprintingModule, AlertsModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, ChildOpportunitiesService],
  exports: [OpportunitiesService, ChildOpportunitiesService],
})
export class OpportunitiesModule {}
