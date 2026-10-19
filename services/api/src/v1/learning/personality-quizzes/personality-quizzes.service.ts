import { Injectable } from '@nestjs/common';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { errorHandler } from '@/common/lib/utils';
import { Query } from '@/common/interfaces';

import { PersonalityQuizzesRepo } from './personality-quizzes.repo';
import { CreatePersonalityQuizType, UpdatePersonalityQuizType, PersonalityQuizSubmission } from './personality-quizzes.dto';
import { gradePlacement, PlacementQuestion } from './placement-grading';
import { QueueService } from '@/v1/queue/queue.service';
import { UserStepsJobSchema } from '@/v1/queue/queue-payloads';

@Injectable()
export class PersonalityQuizzesService {
  constructor(
    private readonly personalityQuizzesRepo: PersonalityQuizzesRepo,
    private readonly queueService: QueueService,
  ) {}

  create(values: CreatePersonalityQuizType) {
    return errorHandler(async () => {
      const quiz = await this.personalityQuizzesRepo.create(values);

      return {
        message: 'Successfully created new personality quiz',
        data: quiz,
      };
    });
  }

  findAll(userId: string, q: Query) {
    return errorHandler(async () => {
      const result = await this.personalityQuizzesRepo.findAll(userId, q);

      return {
        message: 'Successfully retrieved personality quizzes',
        data: {
          data: result.data,
          pagination: {
            page: result.meta.page,
            limit: result.meta.limit,
            total: result.meta.total,
            totalPages: result.meta.totalPages,
          },
        },
      };
    });
  }

  findOne(id: string, q?: Query) {
    return errorHandler(async () => {
      const quiz = await this.personalityQuizzesRepo.findOne('id', id, q);

      if (!quiz) {
        throw new AppError(
          'Personality quiz not found',
          404,
          AppErrorCode.NOT_FOUND
        );
      }

      return {
        message: 'Successfully retrieved personality quiz',
        data: quiz,
      };
    });
  }

  update(id: string, values: UpdatePersonalityQuizType) {
    return errorHandler(async () => {
      const quiz = await this.personalityQuizzesRepo.findOne('id', id);

      if (!quiz) {
        throw new AppError(
          'Personality quiz not found',
          404,
          AppErrorCode.NOT_FOUND
        );
      }

      const updatedQuiz = await this.personalityQuizzesRepo.update(id, values);

      return {
        message: 'Successfully updated personality quiz',
        data: updatedQuiz,
      };
    });
  }

  remove(id: string) {
    return errorHandler(async () => {
      const quiz = await this.personalityQuizzesRepo.findOne('id', id);

      if (!quiz) {
        throw new AppError(
          'Personality quiz not found',
          404,
          AppErrorCode.NOT_FOUND
        );
      }

      await this.personalityQuizzesRepo.delete(id);

      return {
        message: 'Successfully deleted personality quiz',
        data: null,
      };
    });
  }

  submitAttempt(
    data: { userId: string; learningStyleId: string; quizId: string },
    values: PersonalityQuizSubmission,
  ) {
    return errorHandler(async () => {
      const quiz = await this.personalityQuizzesRepo.findForSubmission(data.quizId);
      if (!quiz || quiz.userId !== data.userId) {
        throw new AppError('Personality quiz not found', 404, AppErrorCode.NOT_FOUND);
      }
      if (quiz.takenAt) {
        throw new AppError('Personality quiz was already submitted', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }

      const topicId = quiz.lesson?.subTopic?.topicId;
      if (!topicId) {
        throw new AppError('The lesson of this quiz has no topic', 422, AppErrorCode.VALIDATION_ERROR);
      }

      const job = UserStepsJobSchema.parse({
        userId: data.userId,
        topicId,
        lessonId: quiz.lessonId,
        learningStyleId: data.learningStyleId,
        quizId: data.quizId,
      });
      const ownsStyle = await this.personalityQuizzesRepo.ownsLearningStyle(data.userId, topicId, job.learningStyleId);
      if (!ownsStyle) {
        throw new AppError('Enrol in the topic and take its learning style first', 403, AppErrorCode.ENTITLEMENT_REQUIRED);
      }

      const stored = Array.isArray(quiz.questions) ? (quiz.questions as unknown as PlacementQuestion[]) : [];
      const graded = gradePlacement(stored, values);
      const claimed = await this.personalityQuizzesRepo.claimAttempt(quiz.id, {
        userAttempt: graded.attempt,
        result: graded.result,
        takenAt: new Date(),
      });
      if (!claimed) {
        throw new AppError('Personality quiz was already submitted', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }

      try {
        await this.queueService.addUserStepsJob(job);
      } catch (error) {
        await this.personalityQuizzesRepo.releaseAttempt(quiz.id);
        throw error;
      }

      return {
        message: 'successfully sending answer',
        data: await this.personalityQuizzesRepo.findOne('id', quiz.id),
      };
    });
  }
}
