import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class CreateQueryDto {
  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  query: string;

  @ApiProperty()
  @IsNotEmpty()
  outputType: string;

  @ApiProperty()
  @IsNotEmpty()
  databaseId: number;
}
