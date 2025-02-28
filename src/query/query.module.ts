import { Module } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { QueryEntity } from './entities/query.entity';

@Module({
  imports: [TypeOrmModule.forFeature([QueryEntity]), AuthModule],

  controllers: [QueryController],
  providers: [QueryService],
})
export class QueryModule {}
