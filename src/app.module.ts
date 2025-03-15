import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module';
import { UserdbModule } from './userdb/userdb.module';
import { QueryModule } from './query/query.module';
import { DashboardModule } from './dashboard/dashboard.module';
import llmConfig from './config/llm.config';
import appConfig from './config/app.config';
import encryptionConfig from './config/encryption.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import mailConfig from './config/mail.config';

@Module({
  imports: [
    UserModule,
    DatabaseModule,
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        llmConfig,
        appConfig,
        encryptionConfig,
        jwtConfig,
        redisConfig,
        mailConfig,
      ],
    }),
    UserdbModule,
    QueryModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
