import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FingerprintAction = 'deleted' | 'hidden' | 'not_interested';

export interface FingerprintCheckResult {
  exists: boolean;
  action?: FingerprintAction;
  recordedAt?: Date;
  opportunityId?: string;
}

@Injectable()
export class FingerprintingService {
  private readonly logger = new Logger(FingerprintingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Verifica se um fingerprint já foi registrado
   * Retorna true se o fingerprint existe (duplicata), false se é novo
   */
  async checkFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<FingerprintCheckResult> {
    const record = await this.prisma.opportunityFingerprint.findFirst({
      where: {
        userId,
        fingerprint,
      },
      orderBy: {
        createdAt: 'desc', // Pega o registro mais recente
      },
    });

    if (!record) {
      return { exists: false };
    }

    return {
      exists: true,
      action: record.action as FingerprintAction,
      recordedAt: record.createdAt,
      opportunityId: record.opportunityId || undefined,
    };
  }

  /**
   * Verifica múltiplos fingerprints de uma vez
   * Útil para processar um batch de oportunidades
   */
  async checkMultipleFingerprints(
    userId: string,
    fingerprints: string[],
  ): Promise<Map<string, FingerprintCheckResult>> {
    const records = await this.prisma.opportunityFingerprint.findMany({
      where: {
        userId,
        fingerprint: {
          in: fingerprints,
        },
      },
    });

    // Cria mapa de resultados
    const resultsMap = new Map<string, FingerprintCheckResult>();

    // Inicializa todos como não existentes
    fingerprints.forEach((fp) => {
      resultsMap.set(fp, { exists: false });
    });

    // Atualiza com os que existem
    records.forEach((record) => {
      resultsMap.set(record.fingerprint, {
        exists: true,
        action: record.action as FingerprintAction,
        recordedAt: record.createdAt,
        opportunityId: record.opportunityId || undefined,
      });
    });

    return resultsMap;
  }

  /**
   * Registra um fingerprint quando uma oportunidade é criada
   * Chamado automaticamente pelo OpportunityService ao criar nova oportunidade
   */
  async recordFingerprint(
    userId: string,
    opportunityId: string,
    fingerprint: string,
  ): Promise<void> {
    await this.prisma.opportunityFingerprint.create({
      data: {
        userId,
        opportunityId,
        fingerprint,
        action: 'deleted', // Ação padrão será atualizada se necessário
      },
    });

    this.logger.debug(
      `Fingerprint recorded for opportunity ${opportunityId}: ${fingerprint.substring(0, 16)}...`,
    );
  }

  /**
   * Atualiza a ação de um fingerprint (quando usuário deleta, esconde, etc.)
   */
  async updateFingerprintAction(
    userId: string,
    opportunityId: string,
    action: FingerprintAction,
  ): Promise<void> {
    await this.prisma.opportunityFingerprint.updateMany({
      where: {
        userId,
        opportunityId,
      },
      data: {
        action,
      },
    });

    this.logger.debug(
      `Fingerprint action updated for opportunity ${opportunityId}: ${action}`,
    );
  }

  /**
   * Remove um fingerprint (usado apenas em casos raros, como correção de dados)
   * ATENÇÃO: Usar com cuidado! Pode permitir duplicatas se não for bem pensado
   */
  async removeFingerprintRecord(
    userId: string,
    opportunityId: string,
  ): Promise<void> {
    await this.prisma.opportunityFingerprint.deleteMany({
      where: {
        userId,
        opportunityId,
      },
    });

    this.logger.warn(
      `Fingerprint record removed for opportunity ${opportunityId}`,
    );
  }

  /**
   * Estatísticas de fingerprints do usuário
   */
  async getStatistics(userId: string) {
    const total = await this.prisma.opportunityFingerprint.count({
      where: { userId },
    });

    const byAction = await this.prisma.opportunityFingerprint.groupBy({
      by: ['action'],
      where: { userId },
      _count: {
        action: true,
      },
    });

    return {
      total,
      byAction: byAction.reduce(
        (acc, item) => {
          if (item.action) {
            acc[item.action] = item._count.action;
          }
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  /**
   * Limpa fingerprints muito antigos (opcional, apenas para manutenção)
   * ATENÇÃO: Usar com cuidado! Pode permitir duplicatas de itens muito antigos
   */
  async cleanupOldFingerprints(
    userId: string,
    olderThanDays: number,
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.opportunityFingerprint.deleteMany({
      where: {
        userId,
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Cleaned up ${result.count} fingerprints older than ${olderThanDays} days for user ${userId}`,
    );

    return result.count;
  }
}
