import { ApiProperty } from '@nestjs/swagger';

export class DashboardQueryPositionDto {
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

export class UpdateDashboardQueryPositionsDto {
  @ApiProperty({ type: [DashboardQueryPositionDto] })
  positions: DashboardQueryPositionDto[];
}