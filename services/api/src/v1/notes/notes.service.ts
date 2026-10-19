import { Injectable } from '@nestjs/common';
import { Note, Prisma } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { CreateNoteDtoType, NoteListQueryDtoType, UpdateNoteDtoType } from './notes.dto';

export const MAX_NOTES_PER_USER = 5000;

export interface NoteView {
  id: string;
  title: string;
  body: string;
  source: Note['source'];
  userStepId: string | null;
  userStepTitle: string | null;
  stepTemplateId: string | null;
  chatMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type NoteWithStep = Note & { userStep: { title: string; stepTemplateId: string | null } | null };

const toView = (note: NoteWithStep): NoteView => ({
  id: note.id,
  title: note.title,
  body: note.body,
  source: note.source,
  userStepId: note.userStepId,
  userStepTitle: note.userStep?.title ?? null,
  stepTemplateId: note.userStep?.stepTemplateId ?? null,
  chatMessageId: note.chatMessageId,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

const withStep = { userStep: { select: { title: true, stepTemplateId: true } } } as const;

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateNoteDtoType) {
    const userStepId = await this.resolveStep(userId, dto);

    const duplicate = dto.chatMessageId
      ? await this.prisma.note.findFirst({
          where: { userId, chatMessageId: dto.chatMessageId, title: dto.title, body: dto.body },
          include: withStep,
        })
      : null;
    if (duplicate) {
      return { message: 'Note already saved', data: { ...toView(duplicate), duplicate: true } };
    }

    const total = await this.prisma.note.count({ where: { userId } });
    if (total >= MAX_NOTES_PER_USER) {
      throw new AppError('The note limit is reached; delete some notes first', 409, AppErrorCode.NOTE_LIMIT_REACHED);
    }

    const created = await this.prisma.note.create({
      data: {
        userId,
        userStepId,
        chatMessageId: dto.chatMessageId ?? null,
        title: dto.title,
        body: dto.body,
        source: dto.source,
      },
      include: withStep,
    });
    return { message: 'Note saved', data: { ...toView(created), duplicate: false } };
  }

  async list(userId: string, query: NoteListQueryDtoType) {
    const where: Prisma.NoteWhereInput = {
      userId,
      ...(query.userStepId ? { userStepId: query.userStepId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { body: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        include: withStep,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.note.count({ where }),
    ]);
    return {
      message: 'Successfully retrieved notes',
      data: { data: rows.map(toView), meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } },
    };
  }

  async findOne(id: string) {
    const note = await this.prisma.note.findUnique({ where: { id }, include: withStep });
    if (!note) throw new AppError('Note not found', 404, AppErrorCode.NOT_FOUND);
    return { message: 'Successfully retrieved note', data: toView(note) };
  }

  async update(id: string, dto: UpdateNoteDtoType) {
    const exists = await this.prisma.note.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError('Note not found', 404, AppErrorCode.NOT_FOUND);
    const updated = await this.prisma.note.update({
      where: { id },
      data: { ...(dto.title !== undefined ? { title: dto.title } : {}), ...(dto.body !== undefined ? { body: dto.body } : {}) },
      include: withStep,
    });
    return { message: 'Note updated', data: toView(updated) };
  }

  async remove(id: string) {
    const removed = await this.prisma.note.deleteMany({ where: { id } });
    if (removed.count === 0) throw new AppError('Note not found', 404, AppErrorCode.NOT_FOUND);
    return { message: 'Note deleted', data: null };
  }

  private async resolveStep(userId: string, dto: CreateNoteDtoType): Promise<string | null> {
    if (dto.chatMessageId) {
      const message = await this.prisma.chatMessage.findUnique({
        where: { id: dto.chatMessageId },
        select: { chat: { select: { userStepId: true, userStep: { select: { userId: true } } } } },
      });
      if (!message || message.chat.userStep.userId !== userId) {
        throw new AppError('Message not found', 404, AppErrorCode.NOT_FOUND);
      }
      if (dto.userStepId && dto.userStepId !== message.chat.userStepId) {
        throw new AppError('The message belongs to another step', 422, AppErrorCode.VALIDATION_ERROR);
      }
      return message.chat.userStepId;
    }
    if (dto.userStepId) {
      const step = await this.prisma.userStep.findUnique({ where: { id: dto.userStepId }, select: { userId: true } });
      if (!step || step.userId !== userId) {
        throw new AppError('Step not found', 404, AppErrorCode.NOT_FOUND);
      }
      return dto.userStepId;
    }
    return null;
  }
}
