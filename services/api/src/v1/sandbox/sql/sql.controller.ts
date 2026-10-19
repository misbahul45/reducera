import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { RateLimit } from '@/v1/common/rate-limit/rate-limit.guard';
import { GetUser } from '../../auth/auth.decorator';
import { CheckSqlDto, CheckSqlSchema, RunSqlDto, RunSqlSchema, SqlExerciseParamSchema } from '../dto/sql.dto';
import { SqlPracticeService } from './sql-practice.service';

const exerciseId = new ZodPipe(SqlExerciseParamSchema);

@Controller('sandbox/sql')
export class SqlSandboxController {
  constructor(private readonly practice: SqlPracticeService) {}

  @Get()
  @AuthenticatedOnly()
  catalog(@GetUser() user: AuthUser) {
    return this.practice.catalog(user.id);
  }

  @Post('run')
  @HttpCode(200)
  @AuthenticatedOnly()
  @RateLimit({ scope: 'sandbox_sql', limitPerMinute: 40 })
  run(@Body(new ZodPipe(RunSqlSchema)) dto: RunSqlDto) {
    return this.practice.run(dto);
  }

  @Post('exercises/:id/check')
  @HttpCode(200)
  @AuthenticatedOnly()
  @RateLimit({ scope: 'sandbox_sql', limitPerMinute: 40 })
  check(@Param('id', exerciseId) id: string, @Body(new ZodPipe(CheckSqlSchema)) dto: CheckSqlDto, @GetUser() user: AuthUser) {
    return this.practice.check(user.id, id, dto);
  }

  @Post('exercises/:id/hint')
  @HttpCode(200)
  @AuthenticatedOnly()
  hint(@Param('id', exerciseId) id: string, @GetUser() user: AuthUser) {
    return this.practice.hint(user.id, id);
  }

  @Post('exercises/:id/reveal')
  @HttpCode(200)
  @AuthenticatedOnly()
  reveal(@Param('id', exerciseId) id: string, @GetUser() user: AuthUser) {
    return this.practice.reveal(user.id, id);
  }
}
