import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class DashboardQueryColorDto {
  @ApiProperty({ type: 'number' })
  @Type(() => Number)
  @IsInt()
  dashboardId: number;

  @ApiProperty({ type: 'number' })
  @Type(() => Number)
  @IsInt()
  queryId: number;

  @ApiProperty({ type: 'string', example: '#FFFFFF' })
  titleColor: string;

  @ApiProperty({ type: 'string', example: '#FFFFFF' })
  chartColor: string;
}

export class UpdateDashboardQueryColorDto {
  @ApiProperty({ type: [DashboardQueryColorDto] })
  colors: DashboardQueryColorDto[];
}
