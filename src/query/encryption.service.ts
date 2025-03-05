import { Injectable } from '@nestjs/common';
import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes, 
  scrypt 
} from 'crypto';
import { promisify } from 'util';

@Injectable()
export class EncryptionService {
  // Generate a cryptographically secure random salt
  generateSalt(length = 32): string {
    return randomBytes(length).toString('base64');
  }

  // Generate a strong random password
  generateSecurePassword(length = 32): string {
    return randomBytes(length).toString('base64');
  }

  // Private method to get encryption configuration
  private getEncryptionConfig(): { password: string; salt: string } {
    const password = process.env.ENCRYPTION_PASSWORD;
    const salt = process.env.ENCRYPTION_SALT;

    if (!password || !salt) {
      throw new Error('Encryption configuration is missing. Set ENCRYPTION_PASSWORD and ENCRYPTION_SALT in environment variables.');
    }

    return { password, salt };
  }

  // Derive key using scrypt
  private async deriveKey(password: string, salt: string): Promise<Buffer> {
    return await promisify(scrypt)(password, salt, 32) as Buffer;
  }

  // Async encryption method
  async encrypt(text: string): Promise<string> {
    try {
      // Generate a random IV
      const iv = randomBytes(16);

      // Get encryption configuration
      const { password, salt } = this.getEncryptionConfig();

      // Derive key using scrypt
      const key = await this.deriveKey(password, salt);

      // Create cipher
      const cipher = createCipheriv('aes-256-ctr', key, iv);

      // Encrypt the text
      const encryptedText = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
      ]);

      // Return IV and encrypted text as a single string
      return `${iv.toString('hex')}:${encryptedText.toString('hex')}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  }

  // Async decryption method
  async decrypt(encryptedText: string): Promise<string> {
    try {
      if (!encryptedText) return '';

      // Split IV and encrypted text
      const [ivHex, textHex] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const text = Buffer.from(textHex, 'hex');

      // Get encryption configuration
      const { password, salt } = this.getEncryptionConfig();

      // Derive key using scrypt
      const key = await this.deriveKey(password, salt);

      // Create decipher
      const decipher = createDecipheriv('aes-256-ctr', key, iv);

      // Decrypt the text
      const decryptedText = Buffer.concat([
        decipher.update(text),
        decipher.final()
      ]);

      return decryptedText.toString('utf8');
    } catch (error) {
      console.error('Decryption error:', error);
      throw error;
    }
  }
}