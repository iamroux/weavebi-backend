import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, Max, Min } from 'class-validator';

export class CreateAuthDto {
  @ApiProperty()
  @IsNotEmpty()
  @Min(3)
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  @Min(4)
  @Max(32)
  password: string;
}
