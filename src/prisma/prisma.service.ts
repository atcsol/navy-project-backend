import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Helper para limpar o banco (apenas em testes)
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production');
    }

    // Ordem importante por causa das foreign keys
    await this.$transaction([
      this.processingLog.deleteMany(),
      this.webScrapingConfig.deleteMany(),
      this.opportunityFingerprint.deleteMany(),
      this.opportunity.deleteMany(),
      this.parsingTemplate.deleteMany(),
      this.gmailAccount.deleteMany(),
      this.userPreferences.deleteMany(),
      this.user.deleteMany(),
    ]);
  }
}
