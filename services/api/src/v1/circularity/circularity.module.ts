import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { LearnerModelModule } from '../learner-model/learner-model.module';
import { AdminCircularityController } from './admin-circularity.controller';
import { CircularityMetricsService } from './circularity-metrics.service';

@Module({
  imports: [PrismaModule, LearnerModelModule],
  controllers: [AdminCircularityController],
  providers: [CircularityMetricsService],
  exports: [CircularityMetricsService],
})
export class CircularityModule {}
