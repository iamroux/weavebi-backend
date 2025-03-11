import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class CreateDashboardDto {
  @ApiProperty({example: 'Sales', description: 'The name of the dashboard'})
  @IsNotEmpty()
  name: string;

  @ApiProperty({example: 'My dashboard for sales related data'})
  description: string;

  @ApiProperty({example: 1})
  @IsNotEmpty()
  databaseId: number;

  @ApiProperty({ type: [String], required: false , example: "sales"})
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  tags?: string[];
}
