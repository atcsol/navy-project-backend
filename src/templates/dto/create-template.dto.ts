import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  senderEmail: string; // Email ou domínio do remetente (ex: @us.navy.mil)

  @IsString()
  @IsOptional()
  subjectFilter?: string; // Filtro opcional no assunto (ex: "Daily Procurement")

  @IsString()
  @IsOptional()
  emailQuery?: string; // Query de busca Gmail (ex: "from:noreplyneco@us.navy.mil")

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsObject()
  @IsNotEmpty()
  extractionConfig: ExtractionConfig; // Regras de extração

  @IsObject()
  @IsNotEmpty()
  outputSchema: OutputSchema; // Schema dos campos extraídos

  @IsOptional()
  @IsObject()
  webScrapingConfig?: WebScrapingConfigDto;
}

export interface ExtractionConfig {
  // Tipo de parsing (multiline para emails NECO com múltiplos itens)
  mode: 'single' | 'multiline';

  // Delimitador entre itens (para mode=multiline)
  itemDelimiter?: string;

  // Campos a extrair
  fields: FieldExtraction[];
}

export interface FieldExtraction {
  // Nome do campo no banco (ex: solicitationNumber)
  name: string;

  // Regex para extrair o valor
  pattern: string;

  // Flags do regex (ex: 'gi', 'm')
  flags?: string;

  // Grupo de captura (default: 1)
  group?: number;

  // Transformação opcional
  transform?: 'trim' | 'uppercase' | 'lowercase' | 'date' | 'number' | 'decimal';

  // Campo obrigatório?
  required?: boolean;

  // Valor padrão se não encontrar
  defaultValue?: string | number | boolean | null;
}

export interface OutputSchema {
  // Campos que serão usados para fingerprinting (SHA256)
  fingerprintFields: string[];

  // Mapeamento de campos para a tabela Opportunity
  fieldMapping: {
    [key: string]: string; // campo extraído -> campo do banco
  };
}

export interface TemplateDomain {
  domain: string;
  enabled: boolean;
  reason?: string;
}

export interface WebScrapingConfigDto {
  isEnabled: boolean;
  urlField?: string; // qual campo extraído contém a URL (default: "sourceUrl")
  scrapingFields?: string[]; // campos a extrair: nomenclature, quantity, vendorCode, etc.
  templateDomains?: TemplateDomain[]; // domínios permitidos/bloqueados deste template
}
