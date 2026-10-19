import { Injectable } from '@nestjs/common';
import { Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { tagDistractors } from './misconception-codes';
import { PracticeQuizDtoType } from './practice-quiz.dto';

export const PRACTICE_PASSING_SCORE = 70;

@Injectable()
export class PracticeQuizService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, userStepId: string, dto: PracticeQuizDtoType) {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`practice-quiz:${userStepId}`}))`;
      const step = await tx.userStep.findUnique({ where: { id: userStepId }, select: { userId: true } });
      if (!step || step.userId !== userId) {
        throw new AppError('Step not found', 404, AppErrorCode.NOT_FOUND);
      }

      let tagged = 0;
      const questions = dto.questions.map((question, index) => {
        const distractors = tagDistractors(question.options, question.correctAnswer, question.distractors);
        tagged += Object.keys(distractors).length;
        return {
          question: question.question,
          questionType: QuestionType.MULTIPLE_CHOICE,
          options: question.options as unknown as Prisma.InputJsonValue,
          correctAnswer: question.correctAnswer as unknown as Prisma.InputJsonValue,
          distractors: Object.keys(distractors).length > 0 ? (distractors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          sources: question.sources && question.sources.length > 0 ? (question.sources as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          points: 1,
          sortOrder: index,
        };
      });

      const quiz = await tx.quiz.create({
        data: { title: dto.title, passingScore: PRACTICE_PASSING_SCORE, questions: { create: questions } },
        select: { id: true },
      });
      await tx.userStep.update({ where: { id: userStepId }, data: { quizId: quiz.id } });
      return { quizId: quiz.id, questionCount: questions.length, taggedDistractors: tagged };
    });
    return { message: 'Practice quiz created', data: created };
  }
}
