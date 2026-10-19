import { Module } from '@nestjs/common';
import { TopicBoardController } from './topic-board.controller';
import { TopicBoardService } from './topic-board.service';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { LeaderboardsRepo } from './leaderboards.repo';
import { LeaderboardSseModule } from '@/v1/sse/leaderboard-sse/leaderboard-sse.module';
import { EmittersModule } from '@/v1/emitters/emitters.module';

@Module({
  imports:[PrismaModule, LeaderboardSseModule, EmittersModule],
  controllers: [TopicBoardController],
  providers: [LeaderboardsRepo, TopicBoardService],
  exports: [LeaderboardsRepo],
})
export class LeaderboardsModule {}
