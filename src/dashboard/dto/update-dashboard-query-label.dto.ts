import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateDashboardQueryLabelDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  queryId: number;

  @ApiProperty({ example: 2 })
  @IsNumber()
  dashboardId: number;

  @ApiProperty({ example: 'Query Label' })
  @IsString()
  @IsOptional()
  XAxislabel?: string;

  @ApiProperty({ example: 'Query Label' })
  @IsString()
  @IsOptional()
  YAxislabel?: string;
}
