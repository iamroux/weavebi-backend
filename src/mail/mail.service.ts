import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly mailer;

  constructor(private configService: ConfigService) {
    this.mailer = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });
  }

  private async compileTemplate(templateName: string, context: any): Promise<string> {
    try {
      const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
      const template = fs.readFileSync(templatePath, 'utf8');
      const compiledTemplate = handlebars.compile(template);
      return compiledTemplate(context);
    } catch (error) {
      this.logger.error(`Failed to compile template ${templateName}: ${error.message}`);
      throw new Error(`Template compilation failed`);
    }
  }

  async sendPasswordResetOtp(name:string, email: string, otp: string): Promise<void> {
    const html = await this.compileTemplate('password-reset-otp', {
      name,
      email,
      otp,
      year: new Date().getFullYear(),
    });

    await this.mailer.sendMail({
      to: email,
      subject: 'Password Reset OTP',
      html,
    });
} 

  
}