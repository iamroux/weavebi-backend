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
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redisClient: Redis;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailSesrvice: MailService,
  ) {
    this.redisClient = new Redis({
      host: configService.get<string>('redis.host'),
      port: configService.get<number>('redis.port'),
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
      this.logger.log(`Created new user ${newUser.id}`);
      return 'User created successfully.';
    } catch (error) {
      this.logger.error(`Failed to create user. Error: ${error.message}`);

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

      const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get<string>('jwt.accessTokenExpiresIn'),
      });

      const refreshToken = await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get<string>('jwt.refreshTokenExpiresIn'),
      });

      this.logger.log(`Tokens generated for user ${user.id}`);
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
      };
    } catch (error) {
      this.logger.error(`Login failed: ${error.message}`);
      throw error;
    }
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token must be provided');
    }

    try {
      // Verify the refresh token
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      // Fetch the user by ID from the payload
      const user = await this.getUserByEmail(payload.email);
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate a new access token
      const newAccessToken = await this.jwtService.signAsync(
        { id: user.id, email: user.email, name: user.name },
        {
          expiresIn: this.configService.get<string>('jwt.accessTokenExpiresIn'),
        },
      );

      this.logger.log(`Token refreshed for user ${user.id}`);

      return {
        access_token: newAccessToken,
      };
    } catch (error) {
      this.logger.error(`Failed to refresh token: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async forgotPassword(email: string) {
    const user = await this.getUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    try {
      await this.mailSesrvice.sendPasswordResetOtp(
        user.name,
        user.email,
        otp.toString(),
      );

      await this.redisClient.set(`otp:${email}`, otp, 'EX', 300);
      this.logger.log(`Email sent to ${email}`);
      return 'Email sent.';
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      throw new Error(`Failed to send email Error: ${error.message}`);
    }
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
      this.logger.log(`Password updated for user ${user.id}`);

      return 'Password reset successfully.';
    } catch (error) {
      this.logger.error(`Failed to reset password: ${error.message}`);
      throw new Error('Failed to reset password');
    }
  }
}
