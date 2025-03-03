import { IsInt, IsNotIn, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDashboardQueryPositionDto {
  @ApiProperty()
  dashboardId: number;

  @ApiProperty()
  queryId: number;

  @ApiProperty()
  x: number;

  @ApiProperty()
  y: number;

  @ApiProperty()
  z: number;

  @ApiProperty()
  h: number;
}