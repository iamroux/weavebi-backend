import { Module } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { QueryEntity } from './entities/query.entity';
import { PasswordEncryptionService } from './encryption.service';

@Module({
  imports: [TypeOrmModule.forFeature([QueryEntity]), AuthModule],

  controllers: [QueryController],
  providers: [QueryService, PasswordEncryptionService],
})
export class QueryModule {}
