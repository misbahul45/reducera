import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';

export const SOURCE_TEXT_LIMIT = 3000;
export const TOTAL_TEXT_LIMIT = 14000;
export const MAX_RESOURCES = 6;
export const MAX_CONCEPTS = 8;

export type TopicSourceRef = 'RESOURCE' | 'CONCEPT' | 'TOPIC' | 'SUBTOPIC';

export interface TopicSource {
  refType: TopicSourceRef;
  refId: string;
  title: string;
  text: string;
}

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
const clip = (value: string): string => (value.length > SOURCE_TEXT_LIMIT ? `${value.slice(0, SOURCE_TEXT_LIMIT - 1).trimEnd()}…` : value);

const describe = (title: string, description: string | null | undefined): string => {
  const text = clean(description);
  return text ? clip(text) : '';
};

@Injectable()
export class TopicSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: string, scope: { lessonId?: string; userStepId?: string }) {
    let lessonId = scope.lessonId;
    let stepTitle: string | null = null;

    if (scope.userStepId) {
      const step = await this.prisma.userStep.findUnique({
        where: { id: scope.userStepId },
        select: { userId: true, title: true, stepTemplate: { select: { id: true, lessonId: true } } },
      });
      if (!step || step.userId !== userId) throw new AppError('Step not found', 404, AppErrorCode.NOT_FOUND);
      stepTitle = step.title;
      lessonId = step.stepTemplate?.lessonId ?? lessonId;
    }
    if (!lessonId) throw new AppError('A lesson or a step is required', 422, AppErrorCode.VALIDATION_ERROR);

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        subTopic: { select: { id: true, title: true, description: true, topic: { select: { id: true, title: true, description: true } } } },
      },
    });
    if (!lesson) throw new AppError('Lesson not found', 404, AppErrorCode.NOT_FOUND);

    const { subTopic } = lesson;
    const { topic } = subTopic;
    const enrolled = await this.prisma.userTopic.count({ where: { userId, topicId: topic.id } });
    if (enrolled === 0) throw new AppError('Unlock the topic first', 403, AppErrorCode.ENTITLEMENT_REQUIRED);

    const [resources, links] = await Promise.all([
      this.prisma.resource.findMany({
        where: {
          content: { not: null },
          OR: [{ lessonId: lesson.id }, { subTopicId: subTopic.id }, { topicId: topic.id }, { step: { lessonId: lesson.id } }],
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_RESOURCES,
        select: { id: true, title: true, content: true },
      }),
      this.prisma.conceptCurriculumLink.findMany({
        where: { status: 'APPROVED', concept: { status: 'ACTIVE' }, OR: [{ lessonId: lesson.id }, { subTopicId: subTopic.id }] },
        select: { concept: { select: { id: true, title: true, description: true } } },
        orderBy: { conceptId: 'asc' },
        take: MAX_CONCEPTS * 2,
      }),
    ]);

    const sources: TopicSource[] = [];
    for (const resource of resources) {
      const text = describe(resource.title ?? '', resource.content);
      if (text) sources.push({ refType: 'RESOURCE', refId: resource.id, title: clean(resource.title) || 'Sumber topik', text });
    }

    const seen = new Set<string>();
    for (const { concept } of links) {
      const text = describe(concept.title, concept.description);
      if (!text || seen.has(concept.id) || seen.size >= MAX_CONCEPTS) continue;
      seen.add(concept.id);
      sources.push({ refType: 'CONCEPT', refId: concept.id, title: `Konsep: ${clean(concept.title)}`, text });
    }

    const subTopicText = describe(subTopic.title, subTopic.description);
    if (subTopicText) sources.push({ refType: 'SUBTOPIC', refId: subTopic.id, title: `Sub-topik: ${clean(subTopic.title)}`, text: subTopicText });
    const topicText = describe(topic.title, topic.description);
    if (topicText) sources.push({ refType: 'TOPIC', refId: topic.id, title: `Topik: ${clean(topic.title)}`, text: topicText });

    let used = 0;
    const kept = sources.filter((source) => {
      if (used + source.text.length > TOTAL_TEXT_LIMIT) return false;
      used += source.text.length;
      return true;
    });

    return {
      message: 'Successfully retrieved topic sources',
      data: {
        scope: {
          topicId: topic.id,
          topicTitle: topic.title,
          subTopicId: subTopic.id,
          subTopicTitle: subTopic.title,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          stepTitle,
        },
        sources: kept,
      },
    };
  }
}
