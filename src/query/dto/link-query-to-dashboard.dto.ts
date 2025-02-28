import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class LinkQueryToDashboardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  queryId: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  dashboardId: number;
}
