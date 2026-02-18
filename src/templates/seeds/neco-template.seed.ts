import { CreateTemplateDto } from '../dto/create-template.dto';

/**
 * Template NECO - Baseado no email neco-mensagem.eml
 *
 * Características:
 * - Múltiplos itens por email (modo multiline)
 * - Delimitador: "NECO SOLICITATION NUMBER:"
 * - Campos extraídos: solicitationNumber, site, closingDate, sourceUrl, nsn, description, partNumber
 */
export const necoTemplate: CreateTemplateDto = {
  name: 'NECO Daily Procurement',
  description: 'Template para emails NECO com múltiplas oportunidades por email',

  // Remetente (email ou domínio)
  senderEmail: '@us.navy.mil',

  // Filtro no assunto (opcional)
  subjectFilter: 'Daily Procurement',

  isActive: true,

  // Configuração de extração
  extractionConfig: {
    // Modo multiline: múltiplos itens por email
    mode: 'multiline',

    // Delimitador entre itens
    itemDelimiter: 'NECO SOLICITATION NUMBER:',

    // Campos a extrair (com regex)
    fields: [
      {
        name: 'solicitationNumber',
        pattern: 'NECO SOLICITATION NUMBER:\\s*([A-Z0-9]+)',
        flags: 'i',
        group: 1,
        transform: 'trim',
        required: true,
      },
      {
        name: 'site',
        pattern: 'SITE:\\s*([A-Z]+)',
        flags: 'i',
        group: 1,
        transform: 'uppercase',
        required: false,
        defaultValue: 'NECO',
      },
      {
        name: 'closingDate',
        pattern: 'CLOSING DATE:\\s*([A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4})',
        flags: 'i',
        group: 1,
        transform: 'date',
        required: false,
      },
      {
        name: 'sourceUrl',
        pattern: 'HYPERLINK:\\s*([^\\s]+)',
        flags: 'i',
        group: 1,
        transform: 'trim',
        required: false,
      },
      {
        name: 'nsn',
        pattern: 'National Stock Number:\\s*([0-9-]+)',
        flags: 'i',
        group: 1,
        transform: 'trim',
        required: false,
      },
      {
        name: 'description',
        pattern: 'Nomenclature:\\s*([^\\n]+)',
        flags: 'i',
        group: 1,
        transform: 'trim',
        required: false,
      },
      {
        name: 'partNumber',
        pattern: "Vendor['\u2019]s Part Number:\\s*([^\\n]+)",
        flags: 'i',
        group: 1,
        transform: 'trim',
        required: false,
      },
    ],
  },

  // Schema de saída
  outputSchema: {
    // Campos usados para gerar fingerprint (SHA256)
    // Combinação única: número da solicitação + site
    fingerprintFields: ['solicitationNumber', 'site'],

    // Mapeamento de campos extraídos para campos do banco
    fieldMapping: {
      solicitationNumber: 'solicitationNumber',
      site: 'site',
      closingDate: 'closingDate',
      sourceUrl: 'sourceUrl',
      nsn: 'nsn',
      description: 'description',
      partNumber: 'partNumber',
    },
  },
};
