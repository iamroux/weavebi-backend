import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as nodemailer from 'nodemailer';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redisClient: Redis;
  private readonly mailer;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly configService:ConfigService,
  ) {
    this.redisClient = new Redis({
      host: configService.get<string>('redis.host'),
      port: configService.get<number>('redis.port')
      
    });

    this.mailer = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: configService.get<string>('mail.user'),
        pass: configService.get<string>('mail.pass'),
      },
    });
  }

  async getUserByEmail(email: string): Promise<UserEntity | null> {
    const user = await this.userRepo.findOne({
      where: {
        email,
      },
    });
    return user;
  }

  async create(createAuthDto: CreateAuthDto) {
    try {
      const existingUser = await this.getUserByEmail(createAuthDto.email);
      if (existingUser) {
        throw new ConflictException('User already exists.');
      }
      const newUser = this.userRepo.create({ ...createAuthDto });
      await this.userRepo.save(newUser);
      return 'User created successfully.';
    } catch (error) {
      this.logger.error(`Failed to create user: ${error.message}`);

      if (error instanceof ConflictException) {
        throw error;
      }
      throw new Error('Failed to create user');
    }
  }

  async login(data: LoginDto) {
    const { email, password } = data;
    try {
      const user = await this.getUserByEmail(email);
      if (!user) throw new NotFoundException('User not found');

      const match = await argon2.verify(user.password, password);
      if (!match) throw new UnauthorizedException('Bad credentials');

      const payload = {
        id: user.id,
        email,
        name: user.name,
      };
      const token = await this.jwtService.signAsync(payload);
      return {
        access_token: token,
      };
    } catch (error) {
      this.logger.error(`Login failed: ${error.message}`);
      throw error;
    }
  }

  async forgotPassword(email: string) {
    const user = await this.getUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    const emailTemplate = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; background: #f9f9f9; padding: 20px;">
    <table style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
      <tr>
        <td style="padding: 40px; text-align: center;">
          <h2 style="color: #333333;">🔐 Password Reset Request</h2>
          <p style="color: #555555; font-size: 16px;">You recently requested to reset your password. Use the OTP below to proceed:</p>
          <div style="font-size: 32px; font-weight: bold; color: #4A90E2; margin: 20px 0;">${otp}</div>
          <p style="color: #777777; font-size: 14px;">This OTP will expire in 5 minutes. If you did not request a password reset, please ignore this email.</p>
        </td>
      </tr>
    </table>
    <p style="text-align: center; color: #999999; font-size: 12px; margin-top: 20px;">&copy; ${new Date().getFullYear()} WeaveBI. All rights reserved.</p>
  </div>
`;

    try {
      await this.mailer.sendMail({
        to: email,
        subject: 'Password reset OTP',
        html: emailTemplate,
      });
      await this.redisClient.set(`otp:${email}`, otp, 'EX', 300);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      throw new Error('Failed to send email');
    }

    return 'Email sent.';
  }

  async resetPassword(data: { email: string; otp: string; password: string }) {
    const { email, otp, password } = data;
    const user = await this.getUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    const savedOtp = await this.redisClient.get(`otp:${email}`);
    if (savedOtp != otp) throw new UnauthorizedException('Invalid OTP');

    user.password = password;
    try {
      await this.userRepo.save(user);

      await this.redisClient.del(`otp:${email}`);

      return 'Password reset successfully.';
    } catch (error) {
      this.logger.error(`Failed to reset password: ${error.message}`);
      throw new Error('Failed to reset password');
    }
  }
}
