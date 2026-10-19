import { Controller, Get, Query } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser } from '@/v1/auth/auth.decorator';
import { MarketplaceDiscoveryService } from './marketplace-discovery.service';
import { RecommendationQuery, RecommendationQueryDto } from './marketplace.dto';

@Controller('marketplace-discovery')
@AuthenticatedOnly()
export class MarketplaceDiscoveryController {
  constructor(private readonly discovery: MarketplaceDiscoveryService) {}

  @Get('recommendations')
  async recommendations(@GetUser('id') userId: string, @Query(new ZodPipe(RecommendationQueryDto)) query: RecommendationQuery) {
    return { message: 'Personalized recommendations', data: await this.discovery.recommend(userId, { limit: query.limit }) };
  }
}
