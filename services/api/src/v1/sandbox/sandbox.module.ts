import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { AssessmentGamifyModule } from '@/v1/gamify/assessment-gamify.module';
import { RewardsModule } from '@/v1/gamify/rewards/rewards.module';
import { LearnerModelModule } from '@/v1/learner-model/learner-model.module';
import { MisconceptionModule } from '@/v1/personalization/misconception/misconception.module';
import { RateLimitModule } from '@/v1/common/rate-limit/rate-limit.module';
import { AccountingSandboxService } from './accounting-sandbox.service';
import { SandboxContentService } from './sandbox-content.service';
import { SandboxController } from './sandbox.controller';
import { SandboxPracticeService } from './sandbox-practice.service';
import { SqlContentService } from './sql/sql-content.service';
import { SqlPracticeService } from './sql/sql-practice.service';
import { SqlRunnerService } from './sql/sql-runner.service';
import { SqlSandboxController } from './sql/sql.controller';
import { TryoutController } from './tryout/tryout.controller';
import { TryoutEngineService } from './tryout/tryout-engine.service';
import { TryoutService } from './tryout/tryout.service';

@Module({
  imports: [PrismaModule, LearnerModelModule, RewardsModule, AssessmentGamifyModule, MisconceptionModule, RateLimitModule],
  controllers: [SandboxController, SqlSandboxController, TryoutController],
  providers: [
    AccountingSandboxService,
    SandboxContentService,
    SandboxPracticeService,
    SqlContentService,
    SqlRunnerService,
    SqlPracticeService,
    TryoutEngineService,
    TryoutService,
  ],
  exports: [AccountingSandboxService, SandboxContentService, SandboxPracticeService, SqlPracticeService, TryoutService],
})
export class SandboxModule {}
