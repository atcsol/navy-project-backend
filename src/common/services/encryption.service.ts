import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const keyHex = this.configService.get<string>('ENCRYPTION_KEY');

    if (!keyHex) {
      throw new Error('ENCRYPTION_KEY must be set in environment variables');
    }

    this.key = Buffer.from(keyHex, 'hex');

    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }
  }

  /**
   * Criptografa um texto com IV aleatório por operação
   * Formato de saída: iv_hex:encrypted_hex
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Descriptografa um texto
   * Suporta formato novo (iv:encrypted) e formato legado (apenas encrypted com IV estático)
   */
  decrypt(encryptedText: string): string {
    if (encryptedText.includes(':')) {
      // Formato novo: iv_hex:encrypted_hex
      const [ivHex, encrypted] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    // Formato legado: encrypted com IV estático do env
    const legacyIvHex = this.configService.get<string>('ENCRYPTION_IV');
    if (!legacyIvHex) {
      throw new Error(
        'ENCRYPTION_IV is required to decrypt legacy-format data',
      );
    }
    const legacyIv = Buffer.from(legacyIvHex, 'hex');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      legacyIv,
    );
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Gera um par de chaves novas (para setup inicial)
   */
  static generateKeys(): { key: string; iv: string } {
    return {
      key: crypto.randomBytes(32).toString('hex'),
      iv: crypto.randomBytes(16).toString('hex'),
    };
  }
}
