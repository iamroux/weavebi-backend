import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateAuthDto {
  @ApiProperty()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(32)
  password: string;
}
