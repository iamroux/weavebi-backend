import { Module, OnModuleInit } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { QueryEntity } from './entities/query.entity';
import { EncryptionService } from './encryption.service';
import { UserdbEntity } from 'src/userdb/entities/userdb.entity';

@Module({
  imports: [TypeOrmModule.forFeature([QueryEntity]), AuthModule],

  controllers: [QueryController],
  providers: [QueryService, EncryptionService],
})
export class QueryModule implements OnModuleInit {
  constructor(private readonly encryptionService:EncryptionService){}
  onModuleInit() {
    UserdbEntity.setEncryptoinService(this.encryptionService)
  }
}
