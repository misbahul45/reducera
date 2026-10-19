import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AuditService } from '@/common/authz/audit.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { DEFAULT_LEVELS, LevelRow } from '../me/level-progress';
import { ladderFingerprint, ladderProblems, sameLadder } from './level-ladder';

export interface ReplaceLevelsInput {
  baseFingerprint: string;
  levels: LevelRow[];
  reason: string;
}

export interface LadderView {
  levels: LevelRow[];
  builtin: boolean;
  fingerprint: string;
}

const LADDER_LOCK = 'gamify-levels';

const view = (stored: LevelRow[]): LadderView => {
  const builtin = stored.length === 0;
  const levels = builtin ? DEFAULT_LEVELS.map((row) => ({ ...row })) : stored;
  return { levels, builtin, fingerprint: ladderFingerprint(levels) };
};

const readLadder = async (client: Prisma.TransactionClient | PrismaService): Promise<LadderView> => {
  const rows = await client.levelThreshold.findMany({ orderBy: { level: 'asc' } });
  return view(rows.map((row) => ({ level: row.level, xp: row.xp })));
};

@Injectable()
export class LevelsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  async list(actor: Actor, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    return { message: 'Level ladder', data: await readLadder(tx ?? this.prisma) };
  }

  async replace(actor: Actor, input: ReplaceLevelsInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const problems = ladderProblems(input.levels);
    if (problems.length > 0) throw new AppError(`The ladder is not valid: ${problems.join('; ')}`, 400, AppErrorCode.VALIDATION_ERROR);

    const work = async (client: Prisma.TransactionClient) => {
      await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LADDER_LOCK}))`;
      const before = await readLadder(client);
      if (before.fingerprint !== input.baseFingerprint) {
        throw new AppError('The ladder changed since you opened it; reload it and edit again', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }
      if (sameLadder(before.levels, input.levels)) {
        throw new AppError('This ladder is the same as the one in use', 400, AppErrorCode.VALIDATION_ERROR);
      }

      await client.levelThreshold.deleteMany();
      await client.levelThreshold.createMany({ data: input.levels.map((row) => ({ level: row.level, xp: row.xp })) });

      const after = await readLadder(client);
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'GAMIFY_LEVELS_REPLACED',
          entityType: 'LevelThreshold',
          entityId: 'ladder',
          before: { levels: before.levels } as unknown as Prisma.InputJsonValue,
          after: { levels: after.levels } as unknown as Prisma.InputJsonValue,
          reason: input.reason,
          traceId,
        },
        client as unknown as Pick<PrismaService, 'auditLog'>,
      );
      return after;
    };

    const data = await (tx ? work(tx) : this.prisma.$transaction(work));
    return { message: 'Level ladder replaced', data };
  }
}
