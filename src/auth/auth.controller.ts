import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { ApiOperation, ApiProperty, ApiResponse } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { MessageDto } from 'src/core/dtos/generic-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiProperty({ type: CreateAuthDto })
  @ApiOperation({ summary: 'Register a user' })
  @ApiResponse({
    status: 201,
    type: MessageDto,
    description: 'User created successfully',
  })
  async create(@Body() createAuthDto: CreateAuthDto): Promise<MessageDto> {
    const message = await this.authService.create(createAuthDto);
    return { message };
  }

  @Post('login')
  @ApiProperty({ type: LoginDto })
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ type: LoginDto })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Forgot password' })
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: MessageDto })
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
  ): Promise<MessageDto> {
    const message = await this.authService.forgotPassword(
      forgotPasswordDto.email,
    );
    return { message };
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  @ApiResponse({ type: MessageDto })
  async resetPassword(@Body() body: ResetPasswordDto): Promise<MessageDto> {
    const { email, otp, password } = body;
    const message = await this.authService.resetPassword({
      email,
      otp,
      password,
    });
    return { message };
  }
}
