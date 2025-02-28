import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  email: string;

  @ApiProperty({ example: '123456', description: 'One-time password (OTP)' })
  otp: string;

  @ApiProperty({
    example: 'NewSecurePassword123!',
    description: 'New password',
  })
  password: string;
}
