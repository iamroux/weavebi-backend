import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({ required: false, example: 'user@gmail.com' })
  email?: string;

  @ApiProperty({ required: false, example: 'secret12345' })
  password?: string;

  @ApiProperty({ required: false, example: 'Not John Doe' })
  name?: string;
}
