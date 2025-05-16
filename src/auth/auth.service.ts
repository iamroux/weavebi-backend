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
      const existingUser = await this.getUserByEmail(createAuthDto.email);
      if (existingUser) {
        throw new ConflictException('User already exists.');
      }
      const newUser = this.userRepo.create({ ...createAuthDto });
      await this.userRepo.save(newUser);
      this.logger.log(`Created new user ${newUser.id}`);
      return 'User created successfully.';
    } 

  async login(data: LoginDto) {
    const { email, password } = data;
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
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token must be provided');
    }
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
  }

  async forgotPassword(email: string) {
    const user = await this.getUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
      await this.mailSesrvice.sendPasswordResetOtp(
        user.name,
        user.email,
        otp.toString(),
      );

      await this.redisClient.set(`otp:${email}`, otp, 'EX', 300);
      this.logger.log(`Email sent to ${email}`);
      return 'Email sent.';
  }

  async resetPassword(data: { email: string; otp: string; password: string }) {
    const { email, otp, password } = data;
    const user = await this.getUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    const savedOtp = await this.redisClient.get(`otp:${email}`);
    if (savedOtp != otp) throw new UnauthorizedException('Invalid OTP');

    user.password = password;
      await this.userRepo.save(user);
      await this.redisClient.del(`otp:${email}`);
      this.logger.log(`Password updated for user ${user.id}`);
      return 'Password reset successfully.';
    } 
}
