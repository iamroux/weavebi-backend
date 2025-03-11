import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class CreateQueryDto {
  @ApiProperty({example: 'HR Employee count', description: 'The name of the query'})
  @IsNotEmpty()
  name: string;

  @ApiProperty({example: 'Count of all empoyees in the HD department'})
  @IsNotEmpty()
  query: string;

  @ApiProperty({example: 'tabular'})
  @IsNotEmpty()
  outputType: string;

  @ApiProperty({example: 1})
  @IsNotEmpty()
  databaseId: number;
}
