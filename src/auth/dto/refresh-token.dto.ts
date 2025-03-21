import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token',
    example: 'your_refresh_token_here',
  })
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}