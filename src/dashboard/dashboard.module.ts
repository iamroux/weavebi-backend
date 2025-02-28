import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { DashboardEntity } from './entities/dashboard.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DashboardEntity]), AuthModule],

  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
