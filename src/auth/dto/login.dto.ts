import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'user@gmail.com',
    description: 'The email of the user'
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'secureP@ass123',
    description: 'The password of the user'
  })
  @IsNotEmpty()
  password: string;
}
