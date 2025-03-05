import { Injectable } from '@nestjs/common';
import { createDecipheriv, scrypt } from 'crypto';
import { promisify } from 'util';

@Injectable()
export class PasswordEncryptionService {
  // Private method to derive key using scrypt
  private async deriveKey(password: string, salt: string): Promise<Buffer> {
    return await promisify(scrypt)(password, salt, 32) as Buffer;
  }

  async decrypt(encryptedPassword: string): Promise<string> {
    try {
      if (!encryptedPassword) return '';

      // Get encryption details from environment
      const encryptionPassword = process.env.ENCRYPTION_PASSWORD;
      const encryptionSalt = process.env.ENCRYPTION_SALT;

      if (!encryptionPassword || !encryptionSalt) {
        throw new Error('Encryption configuration is missing');
      }

      // Split IV and encrypted text
      const [ivHex, textHex] = encryptedPassword.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const text = Buffer.from(textHex, 'hex');

      // Derive key using scrypt
      const key = await this.deriveKey(encryptionPassword, encryptionSalt);

      // Create decipher
      const decipher = createDecipheriv('aes-256-ctr', key, iv);

      // Decrypt the text
      const decryptedText = Buffer.concat([
        decipher.update(text),
        decipher.final()
      ]);

      return decryptedText.toString('utf8');
    } catch (error) {
      console.error('Password decryption error:', error);
      throw new Error('Failed to decrypt password');
    }
  }
}