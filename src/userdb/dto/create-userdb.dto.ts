import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { SSLMode } from '../entities/userdb.entity';


export class CreateUserdbDto {
  @ApiProperty()
  @Optional()
  connectionName: string;

  @ApiProperty()
  @Optional()
  description: string;

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

  @ApiProperty({ enum: SSLMode, default: SSLMode.DISABLE })
  @IsOptional()
  @IsEnum(SSLMode)
  ssl?: SSLMode;
  
}
