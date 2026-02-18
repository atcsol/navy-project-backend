import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ParsingTemplate } from '@prisma/client';
import * as crypto from 'crypto';
import { ExtractionConfig, FieldExtraction, OutputSchema } from '../templates/dto/create-template.dto';

export interface ParsedEmail {
  subject: string;
  from: string;
  date: Date;
  body: string;
}

export interface ParsedOpportunity {
  data: Record<string, unknown>; // Dados extraídos
  fingerprint: string; // SHA256 hash
  raw: string; // Texto original
}

interface DataPatternConfig {
  name?: string;
  pattern: string;
  flags?: string;
  columns: Array<{
    name: string;
    group: number;
    transform?: string;
  }>;
}

interface TabularExtractionConfig {
  mode: 'single' | 'multiline' | 'tabular';
  itemDelimiter?: string;
  fields?: FieldExtraction[];
  dataPatterns?: DataPatternConfig[];
  defaults?: Record<string, unknown>;
}

@Injectable()
export class ParsingService {
  private readonly logger = new Logger(ParsingService.name);

  /**
   * Parseia um email usando um template
   */
  async parseEmail(
    email: ParsedEmail,
    template: ParsingTemplate,
  ): Promise<ParsedOpportunity[]> {
    const extractionConfig = template.extractionConfig as unknown as TabularExtractionConfig;
    const outputSchema = template.outputSchema as unknown as OutputSchema;

    // Normaliza line endings: \r\n → \n e \r → \n
    // Gmail retorna text/plain com \r\n, mas os regex patterns usam \n
    const body = email.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Mode single: um item por email
    if (extractionConfig.mode === 'single') {
      const data = this.extractFields(body, extractionConfig.fields || []);
      const fingerprint = this.generateFingerprint(
        data,
        outputSchema.fingerprintFields,
        body,
      );

      return [
        {
          data,
          fingerprint,
          raw: body,
        },
      ];
    }

    // Mode multiline: múltiplos itens por email (NECO)
    if (extractionConfig.mode === 'multiline') {
      const items = this.splitEmailIntoItems(
        body,
        extractionConfig.itemDelimiter || '',
      );

      return items.map((itemText) => {
        const data = this.extractFields(itemText, extractionConfig.fields || []);
        const fingerprint = this.generateFingerprint(
          data,
          outputSchema.fingerprintFields,
          itemText,
        );

        return {
          data,
          fingerprint,
          raw: itemText,
        };
      });
    }

    // Mode tabular: dados em formato de tabela separados por espaço (Solmlbsm/DIBBS)
    // Cada linha de dados é capturada por regex com capture groups
    if (extractionConfig.mode === 'tabular') {
      return this.parseTabular(body, extractionConfig, outputSchema);
    }

    throw new BadRequestException(`Unknown parsing mode: ${extractionConfig.mode}`);
  }

  /**
   * Parseia email no modo tabular (linhas de dados separadas por espaço)
   * Usa múltiplos dataPatterns - cada pattern é um regex com capture groups
   * mapeados para campos via array columns
   */
  private parseTabular(
    body: string,
    config: TabularExtractionConfig,
    outputSchema: OutputSchema,
  ): ParsedOpportunity[] {
    const opportunities: ParsedOpportunity[] = [];
    const dataPatterns: DataPatternConfig[] = config.dataPatterns || [];
    const defaults: Record<string, unknown> = config.defaults || {};
    const seenFingerprints = new Set<string>();

    for (const patternConfig of dataPatterns) {
      try {
        const regex = new RegExp(patternConfig.pattern, patternConfig.flags || 'gm');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(body)) !== null) {
          const data: Record<string, unknown> = { ...defaults };

          for (const col of patternConfig.columns) {
            const rawValue = match[col.group];
            const transformed = rawValue && col.transform
              ? this.transformValue(rawValue, col.transform)
              : rawValue;
            data[col.name] = transformed || null;
          }

          const fingerprint = this.generateFingerprint(
            data,
            outputSchema.fingerprintFields,
            match[0],
          );

          // Evita duplicatas dentro do mesmo email
          if (!seenFingerprints.has(fingerprint)) {
            seenFingerprints.add(fingerprint);
            opportunities.push({
              data,
              fingerprint,
              raw: match[0],
            });
          }
        }
      } catch (error) {
        this.logger.error(
          `Error in tabular pattern "${patternConfig.name || 'unnamed'}": ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Tabular parsing: ${opportunities.length} opportunities extracted from ${dataPatterns.length} pattern(s)`,
    );

    return opportunities;
  }

  /**
   * Divide o email em múltiplos itens
   */
  private splitEmailIntoItems(body: string, delimiter: string): string[] {
    if (!delimiter) {
      return [body];
    }

    // Split pelo delimitador (ex: "NECO SOLICITATION NUMBER:")
    const parts = body.split(new RegExp(`(?=${delimiter})`, 'g'));

    // Remove partes vazias
    return parts.filter((p) => p.trim().length > 0);
  }

  /**
   * Extrai campos do texto usando regex
   */
  private extractFields(
    text: string,
    fieldDefinitions: FieldExtraction[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const field of fieldDefinitions) {
      try {
        const regex = new RegExp(field.pattern, field.flags || '');
        const match = regex.exec(text);

        if (match) {
          const group = field.group || 1;
          const rawValue = match[group];

          // Aplicar transformações
          const transformed = rawValue && field.transform
            ? this.transformValue(rawValue, field.transform)
            : rawValue;

          result[field.name] = transformed;
        } else if (field.required) {
          this.logger.warn(`Required field "${field.name}" not found in text`);
          result[field.name] = field.defaultValue || null;
        } else {
          result[field.name] = field.defaultValue || null;
        }
      } catch (error) {
        this.logger.error(
          `Error extracting field "${field.name}": ${(error as Error).message}`,
        );
        result[field.name] = field.defaultValue || null;
      }
    }

    return result;
  }

  /**
   * Transforma um valor extraído
   */
  private transformValue(value: string, transform: string): string | number | Date | null {
    switch (transform) {
      case 'trim':
        return value.trim();

      case 'uppercase':
        return value.toUpperCase();

      case 'lowercase':
        return value.toLowerCase();

      case 'number':
        const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? null : num;

      case 'decimal':
        const dec = parseFloat(value.replace(/[^0-9.]/g, ''));
        return isNaN(dec) ? null : dec;

      case 'date':
        return this.parseDate(value);

      default:
        return value;
    }
  }

  /**
   * Parseia data (formato flexível)
   * Suporta: "Dec 05, 2025", "10-FEB-26", ISO, etc.
   */
  private parseDate(dateStr: string): Date | null {
    try {
      // Remove espaços extras
      const cleaned = dateStr.trim();

      // Formato "DD-MMM-YY" (ex: "10-FEB-26" = Feb 10, 2026) - Solmlbsm/DIBBS
      const ddMmmYy = cleaned.match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/i);
      if (ddMmmYy) {
        const [, day, month, yearShort] = ddMmmYy;
        const yearNum = parseInt(yearShort);
        const fullYear = yearNum < 50 ? `20${yearShort}` : `19${yearShort}`;
        return this.toUTCDate(month, parseInt(day), parseInt(fullYear));
      }

      // Formato "Dec 05, 2025" ou "February 17, 2026" (NECO)
      const monthDayYear = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (monthDayYear) {
        const [, month, day, year] = monthDayYear;
        return this.toUTCDate(month, parseInt(day), parseInt(year));
      }

      // Formato ISO "2026-02-17" - já é UTC
      const isoDate = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoDate) {
        const date = new Date(cleaned + (cleaned.includes('T') ? '' : 'T00:00:00Z'));
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // Fallback: tenta parse direto mas força meia-noite UTC
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      }

      return null;
    } catch (error) {
      this.logger.error(`Error parsing date "${dateStr}": ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Converte nome de mês + dia + ano para Date UTC meia-noite
   */
  private toUTCDate(month: string, day: number, year: number): Date | null {
    const temp = new Date(`${month} ${day}, ${year}`);
    if (isNaN(temp.getTime())) return null;
    return new Date(Date.UTC(temp.getFullYear(), temp.getMonth(), temp.getDate()));
  }

  /**
   * Gera fingerprint SHA256 baseado em campos específicos
   * Se nenhum campo produzir valor, usa o texto bruto como fallback
   */
  generateFingerprint(
    data: Record<string, unknown>,
    fingerprintFields: string[],
    fallbackText?: string,
  ): string {
    // Cria string com valores dos campos de fingerprint
    const values = fingerprintFields
      .map((field) => {
        const value = data[field];
        return value != null ? String(value).trim().toLowerCase() : '';
      })
      .filter((v) => v.length > 0)
      .join('|');

    // Se nenhum campo de fingerprint produziu valor, usa texto bruto como fallback
    if (!values && fallbackText) {
      this.logger.warn(
        `All fingerprint fields are empty [${fingerprintFields.join(', ')}]. Using raw text fallback.`,
      );
      return crypto
        .createHash('sha256')
        .update(fallbackText.trim())
        .digest('hex');
    }

    if (!values) {
      this.logger.error(
        `All fingerprint fields are empty and no fallback text available. Fields: [${fingerprintFields.join(', ')}]`,
      );
    }

    return crypto.createHash('sha256').update(values).digest('hex');
  }

  /**
   * Valida se um email corresponde ao template
   */
  matchesTemplate(email: ParsedEmail, template: ParsingTemplate): boolean {
    // Valida sender
    const senderMatch = this.matchesSender(email.from, template.senderEmail);
    if (!senderMatch) {
      return false;
    }

    // Valida subject (se configurado)
    if (template.subjectFilter) {
      const subjectMatch = email.subject
        .toLowerCase()
        .includes(template.subjectFilter.toLowerCase());
      if (!subjectMatch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verifica se o email corresponde ao sender configurado
   */
  private matchesSender(emailFrom: string, templateSender: string): boolean {
    const from = emailFrom.toLowerCase();
    const sender = templateSender.toLowerCase();

    // Exact match
    if (from.includes(sender)) {
      return true;
    }

    // Domain match (ex: @us.navy.mil)
    if (sender.startsWith('@')) {
      return from.includes(sender);
    }

    return false;
  }
}
