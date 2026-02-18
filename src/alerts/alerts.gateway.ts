import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/ws',
})
export class AlertsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AlertsGateway.name);
  private jwtSecret: string;

  constructor(private configService: ConfigService) {
    this.jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
  }

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.query.token as string) ||
        client.handshake.auth?.token;

      if (!token) {
        this.logger.warn('WebSocket connection without token, disconnecting');
        client.disconnect();
        return;
      }

      const decoded = jwt.verify(token, this.jwtSecret) as { sub?: string; id?: string };
      const userId = decoded.sub || decoded.id;

      if (!userId) {
        client.disconnect();
        return;
      }

      // Junta o cliente na room do usuário
      client.join(`user:${userId}`);
      client.data.userId = userId;

      this.logger.log(`WebSocket connected: user ${userId}`);
    } catch (error) {
      this.logger.warn(`WebSocket auth failed: ${(error as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.userId) {
      this.logger.log(`WebSocket disconnected: user ${client.data.userId}`);
    }
  }

  /**
   * Emite um alerta para um usuário específico
   */
  emitAlert(userId: string, alert: object) {
    this.server.to(`user:${userId}`).emit('alert', alert);
  }

  /**
   * Emite evento de cancelamento para um usuário específico
   */
  emitCancellation(
    userId: string,
    data: { opportunityId: string; solicitationNumber: string },
  ) {
    this.server.to(`user:${userId}`).emit('cancellation', data);
  }

  /**
   * Emite atualização de oportunidade (para grid em tempo real)
   */
  emitOpportunityUpdate(
    userId: string,
    data: {
      opportunityId: string;
      action: string; // status_changed, updated, created, deleted
      opportunity?: object;
    },
  ) {
    this.server.to(`user:${userId}`).emit('opportunity:update', data);
  }

  /**
   * Emite atualização de contagens de status (para badges das abas)
   */
  emitCountsUpdate(userId: string, counts: Record<string, number>) {
    this.server.to(`user:${userId}`).emit('counts:update', counts);
  }

  /**
   * Emite notificação de resposta de RFQ
   */
  emitRfqResponse(
    userId: string,
    data: {
      rfqId: string;
      rfqItemId: string;
      supplierName: string;
      rfqTitle: string;
    },
  ) {
    this.server.to(`user:${userId}`).emit('rfq:response', data);
  }
}
