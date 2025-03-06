import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class ExecuteQueryDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  databaseId: number;

  @ApiProperty()
  @IsNotEmpty()
  sqlQuery: string;
}
