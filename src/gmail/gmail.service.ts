import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';

export interface TabularPattern {
  signature: string;
  lineCount: number;
  columns: Array<{
    index: number;
    type: string;
    suggestedName: string;
    headerLabel: string | null;
    samples: string[];
  }>;
  sampleLines: string[];
  suggestedRegex: string;
  suggestedFlags: string;
}

interface ExtractedFieldInfo {
  label: string;
  values: string[];
  pattern: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private oauth2Client;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private encryptionService: EncryptionService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_CALLBACK_URL'),
    );
  }

  /**
   * Gera URL de autorização do Google OAuth2
   */
  getAuthUrl(userId: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Para obter refresh_token
      scope: scopes,
      prompt: 'consent', // Força mostrar tela de consentimento
      state: userId, // Passa userId via state para o callback
    });
  }

  /**
   * Troca o código de autorização por tokens
   */
  async handleCallback(userId: string, code: string) {
    try {
      // Troca código por tokens
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new BadRequestException('Failed to obtain tokens from Google');
      }

      // Configura cliente com os tokens
      this.oauth2Client.setCredentials(tokens);

      // Busca informações do usuário (email)
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!data.email) {
        throw new BadRequestException('Could not get email from Google');
      }

      // Criptografa os tokens
      const encryptedAccessToken = this.encryptionService.encrypt(tokens.access_token);
      const encryptedRefreshToken = this.encryptionService.encrypt(tokens.refresh_token);

      // Verifica se já existe conta Gmail para este usuário e email
      const existing = await this.prisma.gmailAccount.findUnique({
        where: {
          userId_email: {
            userId,
            email: data.email,
          },
        },
      });

      if (existing) {
        // Atualiza tokens existentes
        return this.prisma.gmailAccount.update({
          where: { id: existing.id },
          data: {
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            isActive: true,
            updatedAt: new Date(),
          },
        });
      }

      // Cria nova conta Gmail
      return this.prisma.gmailAccount.create({
        data: {
          userId,
          email: data.email,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          isActive: true,
        },
      });
    } catch (error) {
      this.logger.error('Error in handleCallback:', error);
      throw new BadRequestException('Failed to authenticate with Google');
    }
  }

  /**
   * Lista todas as contas Gmail de um usuário
   */
  async findAllByUser(userId: string) {
    return this.prisma.gmailAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        isActive: true,
        lastSync: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Busca uma conta Gmail específica
   */
  async findOne(id: string, userId: string) {
    const account = await this.prisma.gmailAccount.findFirst({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not found');
    }

    return account;
  }

  /**
   * Atualiza uma conta Gmail
   */
  async update(id: string, userId: string, updateData: { isActive?: boolean }) {
    const account = await this.findOne(id, userId);

    return this.prisma.gmailAccount.update({
      where: { id: account.id },
      data: updateData,
    });
  }

  /**
   * Desconecta (desativa) uma conta Gmail
   */
  async disconnect(id: string, userId: string) {
    const account = await this.findOne(id, userId);

    return this.prisma.gmailAccount.update({
      where: { id: account.id },
      data: { isActive: false },
    });
  }

  /**
   * Deleta uma conta Gmail
   */
  async remove(id: string, userId: string) {
    const account = await this.findOne(id, userId);

    await this.prisma.gmailAccount.delete({
      where: { id: account.id },
    });
  }

  /**
   * Obtém cliente OAuth2 autenticado para uma conta
   */
  async getAuthenticatedClient(accountId: string, userId: string) {
    const account = await this.findOne(accountId, userId);

    if (!account.isActive) {
      throw new BadRequestException('Gmail account is not active');
    }

    // Descriptografa tokens
    const accessToken = this.encryptionService.decrypt(account.accessToken);
    const refreshToken = this.encryptionService.decrypt(account.refreshToken);

    // Cria novo cliente OAuth2
    const client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_CALLBACK_URL'),
    );

    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiry?.getTime(),
    });

    // Atualiza tokens se expirados
    client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        const encrypted = this.encryptionService.encrypt(tokens.access_token);
        await this.prisma.gmailAccount.update({
          where: { id: account.id },
          data: {
            accessToken: encrypted,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          },
        });
      }
    });

    return client;
  }

  /**
   * Obtém API do Gmail autenticada
   */
  async getGmailApi(accountId: string, userId: string) {
    const auth = await this.getAuthenticatedClient(accountId, userId);
    return google.gmail({ version: 'v1', auth });
  }

  /**
   * Lista emails do Gmail com filtros
   */
  async listEmails(
    accountId: string,
    userId: string,
    options: {
      query?: string; // Gmail search query (ex: "from:noreplyneco@us.navy.mil")
      maxResults?: number;
    } = {},
  ) {
    const gmail = await this.getGmailApi(accountId, userId);
    const { query = '', maxResults = 20 } = options;

    try {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messages = response.data.messages || [];

      // Busca detalhes de cada mensagem
      const emailPromises = messages.map(async (message) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          id: message.id,
          threadId: message.threadId,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: detail.data.snippet,
        };
      });

      return Promise.all(emailPromises);
    } catch (error) {
      this.logger.error('Error listing emails:', error);
      throw new BadRequestException('Failed to list emails from Gmail');
    }
  }

  /**
   * Obtém conteúdo completo de um email específico
   */
  async getEmailContent(accountId: string, userId: string, messageId: string) {
    const gmail = await this.getGmailApi(accountId, userId);

    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers || [];

      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      // Extrai corpo do email
      let body = '';

      interface GmailMessagePart {
        mimeType?: string | null;
        body?: { data?: string | null } | null;
        parts?: GmailMessagePart[] | null;
      }

      const getBody = (part: GmailMessagePart): string => {
        if (part.body?.data) {
          const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
          this.logger.debug(`[getBody] Found body.data, length: ${decoded.length}, mimeType: ${part.mimeType}`);
          return decoded;
        }

        if (part.parts) {
          this.logger.debug(`[getBody] Processing ${part.parts.length} parts`);

          // Prefere text/plain, depois text/html
          const textPart = part.parts.find((p) => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            const decoded = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
            this.logger.debug(`[getBody] Found text/plain, length: ${decoded.length}`);
            return decoded;
          }

          const htmlPart = part.parts.find((p) => p.mimeType === 'text/html');
          if (htmlPart?.body?.data) {
            const decoded = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
            this.logger.debug(`[getBody] Found text/html, length: ${decoded.length}`);
            // Strip HTML tags para obter texto puro
            return this.stripHtml(decoded);
          }

          // Recursivo para parts aninhadas
          for (const p of part.parts) {
            const result = getBody(p);
            if (result) return result;
          }
        }

        return '';
      };

      body = getBody(message.payload as GmailMessagePart);
      this.logger.debug(`[getEmailContent] Final body length: ${body.length}`);

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        body,
        snippet: message.snippet,
      };
    } catch (error) {
      this.logger.error('Error getting email content:', error);
      throw new BadRequestException('Failed to get email content from Gmail');
    }
  }

  /**
   * Analisa email e extrai campos automaticamente
   * Primeiro detecta padrões tabulares (linhas repetitivas separadas por espaço)
   * Depois extrai campos "Label: Value" das linhas restantes
   */
  async analyzeEmail(accountId: string, userId: string, messageId: string) {
    const email = await this.getEmailContent(accountId, userId, messageId);

    let body = email.body;

    this.logger.debug(`[analyzeEmail] Processing email ${messageId} (${body.length} chars)`);

    // Normaliza line endings e limita tamanho
    body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const MAX_BODY_LENGTH = 100000;
    if (body.length > MAX_BODY_LENGTH) {
      body = body.substring(0, MAX_BODY_LENGTH);
    }

    // PASSO 1: Detecta padrões tabulares (linhas repetitivas com mesma estrutura)
    const tabularResult = this.detectTabularPatterns(body);

    // PASSO 2: Extrai campos "Label: Value" apenas das linhas NÃO tabulares
    const extractedFields = this.extractLabelValueFields(body, tabularResult.tabularLineNumbers);

    const totalFields = Object.keys(extractedFields).length;
    const totalTabular = tabularResult.patterns.length;

    this.logger.log(`Analyzed email ${messageId}: ${totalFields} label:value fields, ${totalTabular} tabular pattern(s)`);

    return {
      email: {
        id: email.id,
        from: email.from,
        subject: email.subject,
        date: email.date,
      },
      extractedFields,
      tabularPatterns: tabularResult.patterns,
      bodyPreview: body.substring(0, 500) + '...',
      totalFields,
    };
  }

  /**
   * Detecta padrões tabulares no corpo do email
   * Classifica cada token de cada linha por tipo (URL, DATE, NUMBER, CODE, WORD)
   * Agrupa linhas com mesma assinatura de tipos
   * Padrões com >5 linhas são considerados tabulares
   */
  private detectTabularPatterns(body: string): {
    patterns: TabularPattern[];
    tabularLineNumbers: Set<number>;
  } {
    const lines = body.split('\n');
    const lineProfiles: Array<{
      lineNum: number;
      text: string;
      tokens: string[];
      types: string[];
      signature: string;
    }> = [];

    // Classifica cada linha
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 10) continue; // Linhas muito curtas

      // FILTRO: Ignora linhas que parecem "Label: Value" (ex: "SITE: NECO")
      // Uma linha é Label:Value se contém "word: value" com colon NÃO em URL
      const hasLabelColon = /^[^:\n]{3,80}:\s+\S/.test(line) &&
        !line.match(/^https?:\/\//i); // Mas não se começa com URL
      if (hasLabelColon) {
        // Verifica se o colon está em posição de label (não dentro de URL)
        const colonPos = line.indexOf(':');
        const beforeColon = line.substring(0, colonPos);
        // Se antes do colon é texto sem URL, é Label:Value → pula
        if (!beforeColon.match(/https?$/i)) continue;
      }

      // Tokeniza por espaços (1+ espaços)
      const tokens = line.split(/\s+/).filter(t => t.length > 0);
      if (tokens.length < 2 || tokens.length > 10) continue; // 2-10 tokens

      // FILTRO: Ignora linhas onde algum token NÃO-URL termina com ":"
      // Isso indica formato "Label: Value" (ex: "NUMBER: SPE4A726T8686")
      const hasColonToken = tokens.some(
        (t, idx) => t.endsWith(':') && !t.match(/^https?:/i),
      );
      if (hasColonToken) continue;

      // Classifica cada token
      const types = tokens.map(t => this.classifyToken(t));

      // FILTRO: Exige pelo menos 1 token "forte" (URL, DATE, LONG_NUM ou CODE)
      // Isso evita que linhas de texto normal sejam consideradas tabulares
      const hasStrongToken = types.some(
        t => t === 'URL' || t === 'DATE' || t === 'LONG_NUM' || t === 'CODE',
      );
      if (!hasStrongToken) continue;

      const signature = types.join(' ');

      lineProfiles.push({ lineNum: i, text: line, tokens, types, signature });
    }

    // Agrupa por assinatura
    const groups = new Map<string, typeof lineProfiles>();
    for (const profile of lineProfiles) {
      if (!groups.has(profile.signature)) {
        groups.set(profile.signature, []);
      }
      groups.get(profile.signature)!.push(profile);
    }

    // Filtra: apenas grupos com >5 linhas são tabulares
    const patterns: TabularPattern[] = [];
    const tabularLineNumbers = new Set<number>();
    const MIN_TABULAR_LINES = 5;

    for (const [signature, group] of groups) {
      if (group.length < MIN_TABULAR_LINES) continue;

      // Tenta detectar header (linha anterior à primeira linha de dados)
      const firstDataLine = group[0].lineNum;
      let headerColumns: string[] | null = null;
      if (firstDataLine > 0) {
        const headerLine = lines[firstDataLine - 1]?.trim();
        if (headerLine) {
          const headerTokens = headerLine.split(/\s{2,}/).map(t => t.trim()).filter(t => t.length > 0);
          if (headerTokens.length === group[0].tokens.length) {
            headerColumns = headerTokens;
          }
        }
      }

      // Gera informação de cada coluna
      const columns = group[0].types.map((type, colIdx) => {
        const sampleValues = group.slice(0, 5).map(g => g.tokens[colIdx]);
        const uniqueSamples = [...new Set(sampleValues)];
        const suggestedName = headerColumns
          ? this.formatFieldName(headerColumns[colIdx])
          : this.suggestColumnName(type, uniqueSamples, colIdx);

        return {
          index: colIdx,
          type,
          suggestedName,
          headerLabel: headerColumns ? headerColumns[colIdx] : null,
          samples: uniqueSamples,
        };
      });

      // Gera regex pattern sugerido
      const regexParts = group[0].types.map((type, idx) => {
        if (type === 'URL') return '(https?://\\S+)';
        if (type === 'DATE') return '(\\d{1,2}-[A-Z]{3}-\\d{2})';
        if (type === 'LONG_NUM') return '(\\d{4}\\S+)';
        if (type === 'CODE') return '(\\S+)';
        return '(\\S+)';
      });
      const suggestedRegex = '^' + regexParts.join('\\s+') + '\\s*$';

      patterns.push({
        signature,
        lineCount: group.length,
        columns,
        sampleLines: group.slice(0, 3).map(g => g.text),
        suggestedRegex,
        suggestedFlags: 'gm',
      });

      // Marca linhas como tabulares
      for (const g of group) {
        tabularLineNumbers.add(g.lineNum);
      }
    }

    // Ordena por quantidade de linhas (mais linhas primeiro)
    patterns.sort((a, b) => b.lineCount - a.lineCount);

    return { patterns, tabularLineNumbers };
  }

  /**
   * Classifica um token por seu tipo
   */
  private classifyToken(token: string): string {
    if (/^https?:\/\//i.test(token)) return 'URL';
    if (/^\d{1,2}-[A-Z]{3}-\d{2}$/i.test(token)) return 'DATE';
    if (/^\d{8,}$/.test(token) || /^\d{4}[A-Z0-9]+\d{3,}$/.test(token)) return 'LONG_NUM';
    if (/^[A-Z]{2,}\d[A-Z0-9]+$/i.test(token) && token.length >= 8) return 'CODE';
    if (/^[A-Z0-9]{2,6}$/i.test(token)) return 'SHORT_ID';
    if (/^\d+$/.test(token)) return 'NUMBER';
    return 'WORD';
  }

  /**
   * Sugere nome para uma coluna baseado no tipo e amostras
   */
  private suggestColumnName(type: string, samples: string[], colIdx: number): string {
    switch (type) {
      case 'URL': return 'sourceUrl';
      case 'DATE': return 'closingDate';
      case 'LONG_NUM': return 'nsn';
      case 'CODE': return colIdx === 0 ? 'solicitationNumber' : `code${colIdx}`;
      case 'SHORT_ID': return colIdx <= 2 ? 'cage' : `id${colIdx}`;
      case 'NUMBER': return `quantity`;
      default: return `column${colIdx}`;
    }
  }

  /**
   * Extrai campos "Label: Value" excluindo linhas tabulares
   */
  private extractLabelValueFields(
    body: string,
    tabularLineNumbers: Set<number>,
  ): Record<string, unknown> {
    const lines = body.split('\n');
    const extractedFields: Record<string, unknown> = {};

    // Filtra linhas tabulares e reconstrói texto
    const filteredBody = lines
      .filter((_, i) => !tabularLineNumbers.has(i))
      .join('\n');

    const universalPattern = /^([^:\n]{3,80}):\s*(.+?)$/gim;
    const fieldMap = new Map<string, ExtractedFieldInfo>();
    const matches = Array.from(filteredBody.matchAll(universalPattern));

    let matchCount = 0;
    const MAX_MATCHES = 1000;

    for (const match of matches) {
      if (matchCount++ > MAX_MATCHES) break;

      const label = match[1].trim();
      const value = match[2].trim();

      if (label.length < 3 || label.length > 80) continue;
      if (!value || value.length < 1) continue;
      if (!/[A-Za-z]{2,}/.test(label)) continue;

      const lowerLabel = label.toLowerCase();
      if (lowerLabel.startsWith('http://') || lowerLabel.startsWith('https://')) continue;

      const fieldName = this.formatFieldName(label);

      if (fieldMap.has(fieldName)) {
        const existing = fieldMap.get(fieldName)!;
        if (existing.values.length < 50) {
          existing.values.push(value);
        }
      } else {
        fieldMap.set(fieldName, {
          label: label,
          values: [value],
          pattern: `${this.escapeRegex(label)}:\\s*(.+?)(?=\\n|$)`,
        });
      }
    }

    const fieldsArray: Array<{ fieldName: string; label: string; count: number; samples: string[]; pattern: string; frequency: number }> = [];
    fieldMap.forEach((data, fieldName) => {
      const uniqueValues = [...new Set(data.values)];
      fieldsArray.push({
        fieldName,
        label: data.label,
        count: uniqueValues.length,
        samples: uniqueValues.slice(0, 5),
        pattern: data.pattern,
        frequency: data.values.length,
      });
    });

    fieldsArray.sort((a, b) => b.frequency - a.frequency);

    fieldsArray.forEach(field => {
      extractedFields[field.fieldName] = {
        label: field.label,
        count: field.count,
        samples: field.samples,
        pattern: field.pattern,
        frequency: field.frequency,
      };
    });

    return extractedFields;
  }

  /**
   * Escapa caracteres especiais de regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Remove tags HTML e retorna texto puro preservando estrutura de linhas
   */
  private stripHtml(html: string): string {
    let text = html;

    // Converte tags de bloco em quebras de linha ANTES de remover as tags
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/tr>/gi, '\n');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n');
    text = text.replace(/<\/td>/gi, '\t');

    // Remove todas as tags HTML restantes
    text = text.replace(/<[^>]*>/g, '');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

    // Colapsa espaços horizontais (NÃO quebras de linha)
    text = text.replace(/[^\S\n]+/g, ' ');

    // Remove espaços no início/fim de cada linha
    text = text.replace(/^ +| +$/gm, '');

    // Limita a no máximo 2 quebras de linha consecutivas
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  /**
   * Envia um email via Gmail API
   */
  async sendEmail(
    accountId: string,
    userId: string,
    options: {
      to: string;
      subject: string;
      htmlBody: string;
      inReplyTo?: string;
      threadId?: string;
    },
  ): Promise<{ messageId: string; threadId: string }> {
    const gmail = await this.getGmailApi(accountId, userId);
    const account = await this.findOne(accountId, userId);

    const boundary = `boundary_${Date.now()}`;
    const messageParts = [
      `From: ${account.email}`,
      `To: ${options.to}`,
      `Subject: ${options.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];

    if (options.inReplyTo) {
      messageParts.push(`In-Reply-To: ${options.inReplyTo}`);
      messageParts.push(`References: ${options.inReplyTo}`);
    }

    const plainText = this.stripHtml(options.htmlBody);

    const rawMessage = [
      ...messageParts,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      plainText,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      options.htmlBody,
      `--${boundary}--`,
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId: options.threadId,
        },
      });

      return {
        messageId: response.data.id!,
        threadId: response.data.threadId!,
      };
    } catch (error) {
      this.logger.error('Error sending email:', error);
      throw new BadRequestException('Failed to send email via Gmail');
    }
  }

  /**
   * Verifica se há novas mensagens em uma thread do Gmail
   */
  async checkThreadForNewMessages(
    accountId: string,
    userId: string,
    threadId: string,
    sinceMessageId: string,
  ): Promise<{ hasNewMessages: boolean; latestMessageId: string | null; snippet: string | null }> {
    const gmail = await this.getGmailApi(accountId, userId);

    try {
      const response = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const messages = response.data.messages || [];

      // Find messages after the original sent message
      let foundOriginal = false;
      let latestNewMessage: { id?: string | null; snippet?: string | null } | null = null;

      for (const msg of messages) {
        if (msg.id === sinceMessageId) {
          foundOriginal = true;
          continue;
        }
        if (foundOriginal) {
          latestNewMessage = msg;
        }
      }

      if (latestNewMessage) {
        return {
          hasNewMessages: true,
          latestMessageId: latestNewMessage.id ?? null,
          snippet: latestNewMessage.snippet ?? null,
        };
      }

      return { hasNewMessages: false, latestMessageId: null, snippet: null };
    } catch (error) {
      this.logger.error('Error checking thread:', error);
      return { hasNewMessages: false, latestMessageId: null, snippet: null };
    }
  }

  /**
   * Formata o nome do label para camelCase
   * Ex: "NECO SOLICITATION NUMBER" -> "necoSolicitationNumber"
   * Ex: "National Stock Number" -> "nationalStockNumber"
   * Ex: "Vendor's (Seller's) Part Number" -> "vendorsPartNumber"
   */
  private formatFieldName(label: string): string {
    // Remove caracteres especiais e parênteses
    let cleaned = label.replace(/['\(\)]/g, '');

    // Remove hífens e underscores, mas mantém espaços
    cleaned = cleaned.replace(/[-_]/g, ' ');

    // Split por espaços
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return 'unknownField';

    // Primeira palavra em lowercase, resto em PascalCase
    const camelCase = words
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (index === 0) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join('');

    return camelCase;
  }
}
