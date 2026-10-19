import { Module } from '@nestjs/common';
import { ThemesService } from './themes.service';
import { ThemesController } from './themes.controller';
import { ThemeProposerService } from './theme-proposer.service';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { ThemesRepo } from './themes.repo';
import { UserThemeController } from './user-theme.controller';
import { UserThemeService } from './user-theme.service';

@Module({
  controllers: [ThemesController, UserThemeController],
  providers: [ThemesService, ThemesRepo, ThemeProposerService, UserThemeService],
  imports: [PrismaModule],
  exports: [ThemesService, ThemesRepo, ThemeProposerService, UserThemeService],
})
export class ThemeModule {}
