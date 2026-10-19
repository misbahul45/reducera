import { PrismaService } from '@/common/config/prisma/prisma.service';
import { errorHandler, validation } from '@/common/lib/utils';
import { Injectable } from '@nestjs/common';
import {
  CreateLeaderboardScoreDto,
  CreateLeaderboardScoreType,
  UpdateLeaderboardScoreDto,
  UpdateLeaderboardScoreType,
} from './leaderboards.dto';
import { LeaderboardEmitter } from '@/v1/emitters/events/leaderboard.emitter';
import { LeaderboardScope, LeaderboardScore } from '@prisma/client';

@Injectable()
export class LeaderboardsRepo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: LeaderboardEmitter,
  ) {}

  async create(values: CreateLeaderboardScoreType) {
    return errorHandler(async () => {
      const data = validation(CreateLeaderboardScoreDto, values);
      if (Array.isArray(data)) {
        return await this.prisma.leaderboardScore.createMany({ data });
      }
      const created = await this.prisma.leaderboardScore.create({ data });
      this.emitter.leaderboardCreated(created);
      return created;
    });
  }

  async update(id: string, values: UpdateLeaderboardScoreType) {
    return errorHandler(async () => {
      const data = validation(UpdateLeaderboardScoreDto, values);
      const result = await this.prisma.leaderboardScore.update({
        where: { id },
        data,
      });
      this.emitter.leaderboardUpdated(result);
      return result;
    });
  }

  async delete(id: string) {
    return errorHandler(async () => {
      const deleted = await this.prisma.leaderboardScore.delete({
        where: { id },
      });
      this.emitter.leaderboardDeleted(deleted);
      return deleted;
    });
  }

  async incrementScore(
    userId: string,
    leaderboardType: LeaderboardScope,
    incrementBy: number,
  ) {
    return errorHandler(async () => {
      const leaderboardScore = await this.prisma.leaderboardScore.findFirst({
        where: { userId, scope: leaderboardType },
      });
      let result;
      if (leaderboardScore) {
        result = await this.prisma.leaderboardScore.update({
          where: { id: leaderboardScore.id },
          data: { score: { increment: incrementBy } },
        });
      } else {
        result = await this.prisma.leaderboardScore.create({
          data: { userId, scope: leaderboardType, score: incrementBy },
        });
      }
      this.emitter.leaderboardUpdated(result);
      return result;
    });
  }
}
