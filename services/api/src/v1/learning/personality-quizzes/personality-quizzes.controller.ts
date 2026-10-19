import { ScopeToUser } from '@/common/authz/access';
import { RequireOwnership } from '@/v1/common/guards/ownership.decorator';
import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PersonalityQuizzesService } from './personality-quizzes.service';
import { CreatePersonalityQuizType, PersonalityQuizSubmission, PersonalityQuizSubmissionSchema, UpdatePersonalityQuizType } from './personality-quizzes.dto';
import { placementForViewer } from './placement-grading';
import { PersonalityQuizSseService } from '@/v1/sse/personality-quiz-sse/personality-quiz-sse.service';
import { GetUser, Roles } from '@/v1/auth/auth.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { Query as QueryInterface } from '@/common/interfaces';
import { Role, User } from '@prisma/client';

@Controller('personality-quizzes')
export class PersonalityQuizzesController {
  constructor(
    private readonly personalityQuizzesService: PersonalityQuizzesService,
    private readonly personalityQuizzesSseService: PersonalityQuizSseService
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @Body() values: CreatePersonalityQuizType,
  ) {
    const res = await this.personalityQuizzesService.create(values);
    this.personalityQuizzesSseService.emitUpdate({
      userId: values.userId,
      personalityQuizId: res.data.id,
    });
    return res;
  }

  @Patch('/submit/:id')
  @RequireOwnership('personality-quiz')
  async submitAttempt(
    @Query() query: { learningStyleId: string },
    @Param('id') id: string,
    @GetUser() user: User,
    @Body(new ZodPipe(PersonalityQuizSubmissionSchema)) values: PersonalityQuizSubmission
  ) {
    const res = await this.personalityQuizzesService.submitAttempt(
      { userId: user.id, learningStyleId: query.learningStyleId, quizId: id },
      values,
    );
    return { ...res, data: placementForViewer(user.role, res.data) };
  }

  @Get()
  @ScopeToUser()
  async findAll(
    @GetUser() user: User,
    @Query() query: QueryInterface
  ) {
    const res = await this.personalityQuizzesService.findAll(user.id, query);
    return { ...res, data: { ...res.data, data: res.data.data.map((quiz) => placementForViewer(user.role, quiz)) } };
  }

  @Get(':id')
  @RequireOwnership('personality-quiz')
  async findOne(@Param('id') id: string, @Query() q: any, @GetUser() user: User) {
    const res = await this.personalityQuizzesService.findOne(id, q);
    return { ...res, data: placementForViewer(user.role, res.data) };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() values: UpdatePersonalityQuizType
  ) {
    return this.personalityQuizzesService.update(id, values);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.personalityQuizzesService.remove(id);
  }
}
