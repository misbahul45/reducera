import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { GetUser, Roles } from '../auth/auth.decorator';
import { CircularityQueryDto, CircularityQueryDtoType } from './circularity.dto';
import { CircularityMetricsService } from './circularity-metrics.service';

@Controller('admin/metrics')
export class AdminCircularityController {
  constructor(private readonly metrics: CircularityMetricsService) {}

  @Roles(Role.ADMIN)
  @Get('circularity')
  report(@Query(new ZodPipe(CircularityQueryDto)) query: CircularityQueryDtoType, @GetUser() user: AuthUser) {
    return this.metrics.report(user, query);
  }
}
