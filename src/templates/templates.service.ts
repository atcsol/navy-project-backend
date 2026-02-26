import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, ExtractionConfig, OutputSchema } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cria um novo template de parsing
   */
  async create(userId: string, createTemplateDto: CreateTemplateDto) {
    // Valida que extractionConfig tem estrutura válida
    this.validateExtractionConfig(createTemplateDto.extractionConfig);

    // Valida que outputSchema tem fingerprintFields
    this.validateOutputSchema(createTemplateDto.outputSchema);

    const template = await this.prisma.parsingTemplate.create({
      data: {
        userId,
        name: createTemplateDto.name,
        description: createTemplateDto.description,
        senderEmail: createTemplateDto.senderEmail,
        subjectFilter: createTemplateDto.subjectFilter,
        emailQuery: createTemplateDto.emailQuery,
        isActive: createTemplateDto.isActive ?? true,
        extractionConfig: createTemplateDto.extractionConfig as unknown as Prisma.InputJsonValue,
        outputSchema: createTemplateDto.outputSchema as unknown as Prisma.InputJsonValue,
      },
    });

    // Cria WebScrapingConfig se fornecido
    if (createTemplateDto.webScrapingConfig) {
      const wsc = createTemplateDto.webScrapingConfig;
      await this.prisma.webScrapingConfig.create({
        data: {
          templateId: template.id,
          isEnabled: wsc.isEnabled,
          urlField: wsc.urlField || 'sourceUrl',
          extractionRules: { scrapingFields: wsc.scrapingFields || [], templateDomains: wsc.templateDomains || [] } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return this.findOne(template.id);
  }

  /**
   * Lista todos os templates do usuário
   */
  async findAll() {
    return this.prisma.parsingTemplate.findMany({
      include: { webScrapingConfig: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lista templates ativos do usuário
   */
  async findActive() {
    return this.prisma.parsingTemplate.findMany({
      where: {
        isActive: true,
      },
      include: { webScrapingConfig: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Busca um template específico
   */
  async findOne(id: string) {
    const template = await this.prisma.parsingTemplate.findFirst({
      where: { id },
      include: { webScrapingConfig: true },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  /**
   * Atualiza um template
   */
  async update(id: string, updateTemplateDto: UpdateTemplateDto) {
    await this.findOne(id); // Verifica se existe

    // Valida campos se foram fornecidos
    if (updateTemplateDto.extractionConfig) {
      this.validateExtractionConfig(updateTemplateDto.extractionConfig);
    }

    if (updateTemplateDto.outputSchema) {
      this.validateOutputSchema(updateTemplateDto.outputSchema);
    }

    const template = await this.prisma.parsingTemplate.update({
      where: { id },
      data: {
        name: updateTemplateDto.name,
        description: updateTemplateDto.description,
        senderEmail: updateTemplateDto.senderEmail,
        subjectFilter: updateTemplateDto.subjectFilter,
        emailQuery: updateTemplateDto.emailQuery,
        isActive: updateTemplateDto.isActive,
        extractionConfig: updateTemplateDto.extractionConfig as unknown as Prisma.InputJsonValue,
        outputSchema: updateTemplateDto.outputSchema as unknown as Prisma.InputJsonValue,
      },
    });

    // Atualiza WebScrapingConfig se fornecido
    if (updateTemplateDto.webScrapingConfig) {
      const wsc = updateTemplateDto.webScrapingConfig;
      await this.prisma.webScrapingConfig.upsert({
        where: { templateId: id },
        create: {
          templateId: id,
          isEnabled: wsc.isEnabled,
          urlField: wsc.urlField || 'sourceUrl',
          extractionRules: { scrapingFields: wsc.scrapingFields || [], templateDomains: wsc.templateDomains || [] } as unknown as Prisma.InputJsonValue,
        },
        update: {
          isEnabled: wsc.isEnabled,
          urlField: wsc.urlField || 'sourceUrl',
          extractionRules: { scrapingFields: wsc.scrapingFields || [], templateDomains: wsc.templateDomains || [] } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return this.findOne(id);
  }

  /**
   * Remove um template
   */
  async remove(id: string) {
    await this.findOne(id); // Verifica se existe

    // Verifica se existem oportunidades usando este template
    const opportunitiesCount = await this.prisma.opportunity.count({
      where: { templateId: id },
    });

    if (opportunitiesCount > 0) {
      throw new BadRequestException(
        `Cannot delete template: ${opportunitiesCount} opportunities are using it`,
      );
    }

    await this.prisma.parsingTemplate.delete({
      where: { id },
    });
  }

  /**
   * Valida estrutura do extractionConfig
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private validateExtractionConfig(config: Record<string, any>) {
    if (!config.mode || !['single', 'multiline', 'tabular'].includes(config.mode)) {
      throw new BadRequestException(
        'extractionConfig.mode must be "single", "multiline", or "tabular"',
      );
    }

    // Modo tabular: valida dataPatterns
    if (config.mode === 'tabular') {
      if (!config.dataPatterns || !Array.isArray(config.dataPatterns) || config.dataPatterns.length === 0) {
        throw new BadRequestException(
          'extractionConfig.dataPatterns must be a non-empty array for tabular mode',
        );
      }

      for (const pattern of config.dataPatterns) {
        if (!pattern.pattern) {
          throw new BadRequestException('Each dataPattern must have a "pattern"');
        }
        try {
          new RegExp(pattern.pattern, pattern.flags || 'gm');
        } catch (error) {
          throw new BadRequestException(
            `Invalid regex in dataPattern "${pattern.name || 'unnamed'}": ${(error as Error).message}`,
          );
        }
        if (!pattern.columns || !Array.isArray(pattern.columns) || pattern.columns.length === 0) {
          throw new BadRequestException(
            `dataPattern "${pattern.name || 'unnamed'}" must have a non-empty "columns" array`,
          );
        }
      }
      return;
    }

    if (!config.fields || !Array.isArray(config.fields)) {
      throw new BadRequestException(
        'extractionConfig.fields must be an array',
      );
    }

    if (config.fields.length === 0) {
      throw new BadRequestException(
        'extractionConfig.fields cannot be empty',
      );
    }

    // Valida cada campo
    for (const field of config.fields) {
      if (!field.name) {
        throw new BadRequestException('Each field must have a "name"');
      }

      if (!field.pattern) {
        throw new BadRequestException(
          `Field "${field.name}" must have a "pattern"`,
        );
      }

      // Testa se o regex é válido
      try {
        new RegExp(field.pattern, field.flags || '');
      } catch (error) {
        throw new BadRequestException(
          `Invalid regex pattern for field "${field.name}": ${(error as Error).message}`,
        );
      }
    }

    // Valida modo multiline
    if (config.mode === 'multiline' && !config.itemDelimiter) {
      throw new BadRequestException(
        'extractionConfig.itemDelimiter is required for multiline mode',
      );
    }
  }

  /**
   * Valida estrutura do outputSchema
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private validateOutputSchema(schema: Record<string, any>) {
    if (!schema.fingerprintFields || !Array.isArray(schema.fingerprintFields)) {
      throw new BadRequestException(
        'outputSchema.fingerprintFields must be an array',
      );
    }

    if (schema.fingerprintFields.length === 0) {
      throw new BadRequestException(
        'outputSchema.fingerprintFields cannot be empty',
      );
    }

    if (!schema.fieldMapping || typeof schema.fieldMapping !== 'object') {
      throw new BadRequestException(
        'outputSchema.fieldMapping must be an object',
      );
    }
  }
}
