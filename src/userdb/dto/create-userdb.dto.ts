import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class CreateUserdbDto {

  @ApiProperty()
  @Optional()
  connectionName: string;
  
  @ApiProperty()
  @IsNotEmpty()
  provider: string;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  username: string;

  @ApiProperty()
  @IsNotEmpty()
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  host: string;

  @ApiProperty()
  @IsNotEmpty()
  port: number;
}
