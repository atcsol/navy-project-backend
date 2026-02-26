import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FingerprintingService } from '../fingerprinting/fingerprinting.service';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { NecoLineItem, NecoExtractedData } from '../scraping/neco-extractor';
import { OpportunityStatus } from '../common/constants/opportunity.constants';
import { DEFAULT_PROFIT_MARGIN } from '../common/constants/app.constants';
import * as crypto from 'crypto';

@Injectable()
export class ChildOpportunitiesService {
  private readonly logger = new Logger(ChildOpportunitiesService.name);

  constructor(
    private prisma: PrismaService,
    private fingerprintingService: FingerprintingService,
  ) {}

  /**
   * Cria oportunidades filhas a partir de lineItems do scraping NECO.
   * Só cria se totalLineItems > 1.
   * Retorna número de filhas criadas.
   */
  async createChildrenFromScraping(
    parentId: string,
    necoData: NecoExtractedData,
  ): Promise<number> {
    if (!necoData.lineItems || necoData.lineItems.length <= 1) return 0;

    const parent = await this.prisma.opportunity.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        userId: true,
        templateId: true,
        gmailAccountId: true,
        emailMessageId: true,
        emailThreadId: true,
        emailDate: true,
        solicitationNumber: true,
        site: true,
        sourceUrl: true,
        closingDate: true,
        deliveryDate: true,
        status: true,
        childrenCount: true,
        parentOpportunityId: true,
      },
    });

    if (!parent) return 0;

    // Não cria filhas de filhas
    if (parent.parentOpportunityId) return 0;

    // Se já tem filhas, pula (evita duplicatas em re-scrape)
    if (parent.childrenCount > 0) {
      this.logger.debug(`Parent ${parentId} already has ${parent.childrenCount} children, skipping`);
      return 0;
    }

    let created = 0;

    for (const lineItem of necoData.lineItems) {
      const fingerprint = this.generateChildFingerprint(
        parent.solicitationNumber,
        lineItem,
      );

      // Verifica duplicata
      const fpCheck = await this.fingerprintingService.checkFingerprint(
        parent.userId,
        fingerprint,
      );
      if (fpCheck.exists) {
        this.logger.debug(`Child fingerprint exists: ${fingerprint.substring(0, 16)}...`);
        continue;
      }

      const child = await this.prisma.opportunity.create({
        data: {
          userId: parent.userId,
          templateId: parent.templateId,
          gmailAccountId: parent.gmailAccountId,
          emailMessageId: parent.emailMessageId,
          emailThreadId: parent.emailThreadId,
          emailDate: parent.emailDate,
          fingerprint,
          parentOpportunityId: parent.id,
          // Dados herdados do parent
          solicitationNumber: parent.solicitationNumber,
          site: parent.site,
          sourceUrl: parent.sourceUrl,
          closingDate: parent.closingDate,
          deliveryDate: parent.deliveryDate,
          status: parent.status || OpportunityStatus.NAO_ANALISADA,
          profitMargin: new Decimal(DEFAULT_PROFIT_MARGIN),
          // Dados específicos do lineItem
          nsn: lineItem.nsn || null,
          partNumber: lineItem.vendorPartNumber || null,
          manufacturer: lineItem.vendorCode || null,
          description: lineItem.nomenclature || null,
          quantity: lineItem.quantity || null,
          unit: lineItem.unit || null,
          condition: necoData.itemCondition || null,
          // Dados completos do lineItem no extractedData
          extractedData: {
            lineItem: lineItem.lineItem,
            fromParent: parent.id,
            ...this.lineItemToExtractedData(lineItem, necoData),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      await this.fingerprintingService.recordFingerprint(
        parent.userId,
        child.id,
        fingerprint,
      );

      created++;
    }

    // Atualiza contagem de filhas no parent
    if (created > 0) {
      await this.prisma.opportunity.update({
        where: { id: parentId },
        data: { childrenCount: created },
      });
    }

    this.logger.log(
      `Created ${created} children for parent ${parentId} (${parent.solicitationNumber})`,
    );

    return created;
  }

  /**
   * Lista filhas de uma oportunidade parent
   */
  async findChildren(parentId: string) {
    return this.prisma.opportunity.findMany({
      where: {
        parentOpportunityId: parentId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Gera fingerprint único para uma filha baseado no solicitation + lineItem
   */
  private generateChildFingerprint(
    solicitationNumber: string | null,
    lineItem: NecoLineItem,
  ): string {
    const parts = [
      solicitationNumber || '',
      lineItem.lineItem || '',
      lineItem.nsn || '',
      lineItem.vendorCode || '',
      lineItem.vendorPartNumber || '',
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * Converte lineItem para formato extractedData (dados relevantes da filha)
   */
  private lineItemToExtractedData(
    lineItem: NecoLineItem,
    necoData: NecoExtractedData,
  ): Record<string, unknown> {
    return {
      nsn: lineItem.nsn,
      nomenclature: lineItem.nomenclature,
      quantity: lineItem.quantity,
      unit: lineItem.unit,
      vendorCode: lineItem.vendorCode,
      vendorPartNumber: lineItem.vendorPartNumber,
      cageRefNo: lineItem.cageRefNo,
      sowText: lineItem.sowText,
      subLineItems: lineItem.subLineItems,
      // Dados globais do parent
      buyerName: necoData.buyerName,
      buyerEmail: necoData.buyerEmail,
      buyerPhone: necoData.buyerPhone,
      contractType: necoData.contractType,
      setAside: necoData.setAside,
      leadTimeDays: necoData.leadTimeDays,
      fobPoint: necoData.fobPoint,
    };
  }
}
