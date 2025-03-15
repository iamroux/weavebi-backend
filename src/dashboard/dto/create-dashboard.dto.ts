import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class CreateDashboardDto {
  @ApiProperty({ example: 'Sales' })
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Sales dashboard for the year 2021 HR department' })
  description: string;

  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  databaseId: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  tags?: string[];
}
