import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAlertDto {
  userId: string;
  opportunityId: string;
  type: string; // cancellation, status_change, amendment, deadline_warning
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private prisma: PrismaService) {}

  async createAlert(dto: CreateAlertDto) {
    const alert = await this.prisma.opportunityAlert.create({
      data: {
        userId: dto.userId,
        opportunityId: dto.opportunityId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        metadata: (dto.metadata as Prisma.InputJsonValue) || Prisma.JsonNull,
      },
    });

    this.logger.log(
      `Alert created: ${alert.type} for opportunity ${dto.opportunityId}`,
    );

    return alert;
  }

  async findAll(
    userId: string,
    page: number = 1,
    limit: number = 20,
    filters?: { unreadOnly?: boolean; type?: string },
  ) {
    const skip = (page - 1) * limit;
    const where: { userId: string; isRead?: boolean; type?: string } = { userId };

    if (filters?.unreadOnly) {
      where.isRead = false;
    }

    if (filters?.type) {
      where.type = filters.type;
    }

    const [total, alerts] = await Promise.all([
      this.prisma.opportunityAlert.count({ where }),
      this.prisma.opportunityAlert.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          opportunity: {
            select: {
              id: true,
              solicitationNumber: true,
              status: true,
            },
          },
        },
      }),
    ]);

    return {
      data: alerts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead(alertId: string, userId: string) {
    return this.prisma.opportunityAlert.updateMany({
      where: { id: alertId, userId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.opportunityAlert.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.opportunityAlert.count({
      where: { userId, isRead: false },
    });
    return { count };
  }
}
