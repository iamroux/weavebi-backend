import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { SSLMode } from '../entities/userdb.entity';

export class CreateUserdbDto {
  @ApiProperty({ example: 'employees' })
  @Optional()
  connectionName: string;

  @ApiProperty({ example: 'This is my test employees database' })
  @Optional()
  description: string;

  @ApiProperty({ example: 'postgres' })
  @IsNotEmpty()
  provider: string;

  @ApiProperty({ example: 'employees' })
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'postgres' })
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'secret' })
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'localhost' })
  @IsNotEmpty()
  host: string;

  @ApiProperty({ example: 5432 })
  @IsNotEmpty()
  port: number;

  @ApiProperty({ enum: SSLMode, default: SSLMode.DISABLE })
  @IsOptional()
  @IsEnum(SSLMode)
  ssl?: SSLMode;
}
