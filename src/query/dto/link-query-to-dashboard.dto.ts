import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class LinkQueryToDashboardDto {
  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  @IsNumber()
  queryId: number;

  @ApiProperty({ example: 2 })
  @IsNotEmpty()
  @IsNumber()
  dashboardId: number;
}
