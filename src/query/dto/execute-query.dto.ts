import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class ExecuteQueryDto {
  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  @IsNumber()
  databaseId: number;

  @ApiProperty({ example: 'SELECT * FROM employees;' })
  @IsNotEmpty()
  sqlQuery: string;
}
