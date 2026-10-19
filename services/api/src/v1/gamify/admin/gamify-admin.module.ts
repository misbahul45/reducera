import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { AchievementsAdminService } from './achievements-admin.service';
import { GamifyAdminController } from './gamify-admin.controller';
import { LevelsAdminService } from './levels-admin.service';
import { RulesAdminService } from './rules-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [GamifyAdminController],
  providers: [RulesAdminService, LevelsAdminService, AchievementsAdminService],
})
export class GamifyAdminModule {}
