import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInRUUyROpomN9IWzL2K...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
