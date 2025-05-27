import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateQueryDto {
  @ApiProperty({
    example: 'HR Employee count',
    description: 'The name of the query',
  })
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({ example: 'Count of all empoyees in the HD department' })
  @IsNotEmpty()
  @IsOptional()
  query?: string;

  @ApiProperty({ example: 'tabular' })
  @IsNotEmpty()
  @IsOptional()
  outputType?: string;
}
