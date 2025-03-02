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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private redisClient: Redis;
  private mailer;

  constructor(
    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,
    private jwtService: JwtService,
  ) {
    this.redisClient = new Redis(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),

      }
    );

    this.mailer = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
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

    try {
      await this.mailer.sendMail({
        to: email,
        subject: 'Password reset OTP',
        text: `Your OTP is ${otp}`,
        html: `<b>Your OTP is ${otp}</b>`,
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
