import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { ChatCitation } from '../chat/chat-message-extras';

@Injectable()
export class LessonIntroductionService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, lessonId: string, input: { introduction: string; citations: ChatCitation[] }) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId }, select: { subTopic: { select: { topicId: true } } } });
    if (!lesson) throw new AppError('Lesson not found', 404, AppErrorCode.NOT_FOUND);

    const enrolled = await this.prisma.userTopic.count({ where: { userId, topicId: lesson.subTopic.topicId } });
    if (enrolled === 0) throw new AppError('Unlock the topic first', 403, AppErrorCode.ENTITLEMENT_REQUIRED);

    const citations = input.citations as unknown as Prisma.InputJsonValue;
    const saved = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, introduction: input.introduction, introductionCitations: citations },
      update: { introduction: input.introduction, introductionCitations: citations },
      select: { id: true },
    });
    return { message: 'Introduction saved', data: { id: saved.id, citations: input.citations.length } };
  }
}
