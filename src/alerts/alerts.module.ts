import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { AlertsGateway } from './alerts.gateway';

@Module({
  imports: [ConfigModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsGateway],
  exports: [AlertsService, AlertsGateway],
})
export class AlertsModule {}
