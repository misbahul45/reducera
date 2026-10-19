import { Injectable } from '@nestjs/common';
import { Achievement, AchievementType, Prisma } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AuditService } from '@/common/authz/audit.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { AchievementRule, parseAchievementRule } from '../achievements/achievement-rule';
import { THEME_ICON_NAMES } from '../themes/theme-icons';
import {
  ACHIEVEMENT_METRIC_SPECS,
  CreateAchievementInput,
  UpdateAchievementInput,
  achievementTypeFor,
} from './achievement-authoring';

export interface ReasonInput {
  reason: string;
}

export interface AchievementView {
  code: string | null;
  title: string;
  description: string | null;
  iconName: string | null;
  type: AchievementType;
  rule: AchievementRule | null;
  sortOrder: number;
  active: boolean;
  unlockedCount: number;
  createdAt: Date;
}

type AchievementAction = 'GAMIFY_ACHIEVEMENT_CREATED' | 'GAMIFY_ACHIEVEMENT_UPDATED' | 'GAMIFY_ACHIEVEMENT_ACTIVATED' | 'GAMIFY_ACHIEVEMENT_DEACTIVATED';

type Presentation = Pick<Achievement, 'title' | 'description' | 'iconName' | 'sortOrder'>;

const PRESENTATION_FIELDS = ['title', 'description', 'iconName', 'sortOrder'] as const;

const toView = (row: Achievement, unlockedCount: number): AchievementView => ({
  code: row.code,
  title: row.title,
  description: row.description,
  iconName: row.iconName,
  type: row.type,
  rule: parseAchievementRule(row.rule),
  sortOrder: row.sortOrder,
  active: row.active,
  unlockedCount,
  createdAt: row.createdAt,
});

const notFound = (code: string) => new AppError(`No achievement has the code ${code}`, 404, AppErrorCode.NOT_FOUND);

@Injectable()
export class AchievementsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  async list(actor: Actor, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const client = tx ?? this.prisma;
    const [rows, counts] = await Promise.all([
      client.achievement.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      client.userAchievement.groupBy({ by: ['achievementId'], _count: { _all: true } }),
    ]);
    const unlocked = new Map(counts.map((row) => [row.achievementId, row._count._all]));
    return {
      message: 'Achievements',
      data: {
        achievements: rows.map((row) => toView(row, unlocked.get(row.id) ?? 0)),
        metrics: ACHIEVEMENT_METRIC_SPECS,
        icons: [...THEME_ICON_NAMES],
      },
    };
  }

  async create(actor: Actor, input: CreateAchievementInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const work = async (client: Prisma.TransactionClient) => {
      await this.lock(client, input.code);
      const taken = await client.achievement.findUnique({ where: { code: input.code }, select: { id: true } });
      if (taken) throw new AppError(`The code ${input.code} is already used`, 409, AppErrorCode.UNIQUE_CONSTRAINT_FAILED);

      const rule: AchievementRule = { metric: input.rule.metric, op: '>=', value: input.rule.value };
      const row = await client.achievement.create({
        data: {
          code: input.code,
          title: input.title,
          description: input.description,
          iconName: input.iconName,
          type: achievementTypeFor(rule.metric),
          rule,
          sortOrder: input.sortOrder,
          active: true,
        },
      });
      await this.record(client, actor, 'GAMIFY_ACHIEVEMENT_CREATED', row.code as string, input.reason, traceId, null, {
        title: row.title,
        description: row.description,
        iconName: row.iconName,
        type: row.type,
        rule,
        sortOrder: row.sortOrder,
        active: true,
      });
      return toView(row, 0);
    };
    return { message: 'Achievement created', data: await this.within(tx, work) };
  }

  async update(actor: Actor, code: string, input: UpdateAchievementInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const work = async (client: Prisma.TransactionClient) => {
      await this.lock(client, code);
      const current = await this.find(client, code);
      const patch: Partial<Presentation> = {};
      for (const field of PRESENTATION_FIELDS) {
        const next = input[field];
        if (next !== undefined && next !== current[field]) (patch as Record<string, unknown>)[field] = next;
      }
      const changed = Object.keys(patch) as Array<keyof Presentation>;
      if (changed.length === 0) throw new AppError('Nothing changed', 400, AppErrorCode.VALIDATION_ERROR);

      const row = await client.achievement.update({ where: { id: current.id }, data: patch });
      await this.record(
        client,
        actor,
        'GAMIFY_ACHIEVEMENT_UPDATED',
        code,
        input.reason,
        traceId,
        Object.fromEntries(changed.map((field) => [field, current[field]])),
        Object.fromEntries(changed.map((field) => [field, row[field]])),
      );
      return toView(row, await client.userAchievement.count({ where: { achievementId: row.id } }));
    };
    return { message: 'Achievement updated', data: await this.within(tx, work) };
  }

  activate(actor: Actor, code: string, input: ReasonInput, traceId?: string, tx?: Prisma.TransactionClient) {
    return this.setActive(actor, code, true, input, traceId, tx);
  }

  deactivate(actor: Actor, code: string, input: ReasonInput, traceId?: string, tx?: Prisma.TransactionClient) {
    return this.setActive(actor, code, false, input, traceId, tx);
  }

  private async setActive(actor: Actor, code: string, active: boolean, input: ReasonInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const work = async (client: Prisma.TransactionClient) => {
      await this.lock(client, code);
      const current = await this.find(client, code);
      if (current.active === active) {
        throw new AppError(`${code} is already ${active ? 'active' : 'retired'}`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }
      const row = await client.achievement.update({ where: { id: current.id }, data: { active } });
      await this.record(client, actor, active ? 'GAMIFY_ACHIEVEMENT_ACTIVATED' : 'GAMIFY_ACHIEVEMENT_DEACTIVATED', code, input.reason, traceId, { active: current.active }, { active });
      return toView(row, await client.userAchievement.count({ where: { achievementId: row.id } }));
    };
    return { message: active ? 'Achievement activated' : 'Achievement retired', data: await this.within(tx, work) };
  }

  private within<T>(tx: Prisma.TransactionClient | undefined, work: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.prisma.$transaction(work);
  }

  private async lock(client: Prisma.TransactionClient, code: string): Promise<void> {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gamify-achievement:${code}`}))`;
  }

  private async find(client: Prisma.TransactionClient, code: string): Promise<Achievement> {
    const row = await client.achievement.findUnique({ where: { code } });
    if (!row) throw notFound(code);
    return row;
  }

  private record(
    client: Prisma.TransactionClient,
    actor: Actor,
    action: AchievementAction,
    code: string,
    reason: string,
    traceId: string | undefined,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    return this.audit.record(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action,
        entityType: 'Achievement',
        entityId: code,
        before: before as Prisma.InputJsonValue | null,
        after: after as Prisma.InputJsonValue,
        reason,
        traceId,
      },
      client as unknown as Pick<PrismaService, 'auditLog'>,
    );
  }
}
