import { Module } from '@nestjs/common';
import { UserdbService } from './userdb.service';
import { UserdbController } from './userdb.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { UserdbEntity } from './entities/userdb.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserdbEntity]), AuthModule],

  controllers: [UserdbController],
  providers: [UserdbService],
})
export class UserdbModule {}
