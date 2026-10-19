import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser } from '@/v1/auth/auth.decorator';
import { UserThemeDto, UserThemeDtoType } from './user-theme.dto';
import { UserThemeService } from './user-theme.service';

@Controller('me/theme')
export class UserThemeController {
  constructor(private readonly themes: UserThemeService) {}

  @Get()
  @AuthenticatedOnly()
  mine(@GetUser('id') userId: string) {
    return this.themes.get(userId);
  }

  @Put()
  @AuthenticatedOnly()
  @HttpCode(200)
  save(@GetUser('id') userId: string, @Body(new ZodPipe(UserThemeDto)) dto: UserThemeDtoType) {
    return this.themes.save(userId, dto);
  }

  @Post('preview')
  @AuthenticatedOnly()
  @HttpCode(200)
  preview(@Body(new ZodPipe(UserThemeDto)) dto: UserThemeDtoType) {
    return this.themes.preview(dto);
  }

  @Delete()
  @AuthenticatedOnly()
  @HttpCode(200)
  reset(@GetUser('id') userId: string) {
    return this.themes.reset(userId);
  }
}
