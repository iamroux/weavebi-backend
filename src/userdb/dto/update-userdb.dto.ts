import { PartialType } from '@nestjs/swagger';
import { CreateUserdbDto } from './create-userdb.dto';

export class UpdateUserdbDto extends PartialType(CreateUserdbDto) {}
