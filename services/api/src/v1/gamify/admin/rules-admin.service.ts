import { Injectable } from '@nestjs/common';
import { Prisma, RewardRule } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AuditService } from '@/common/authz/audit.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { RULE_CATALOG, RuleDefinition, publishSchemaFor, ruleDefinition } from './rule-catalog';
import { PublishInput, RuleView, StoredRule, WritePlan, describeRule, inForce, planActivate, planDeactivate, planPublish } from './rule-versions';

export interface PublishRuleInput {
  baseVersion: number;
  values: Record<string, number>;
  reason: string;
}

export interface ReasonInput {
  reason: string;
}

type RuleAction = 'GAMIFY_RULE_PUBLISHED' | 'GAMIFY_RULE_ACTIVATED' | 'GAMIFY_RULE_DEACTIVATED';

const toStored = (row: RewardRule): StoredRule => ({
  code: row.code,
  version: row.version,
  eventType: row.eventType,
  rewardKind: row.rewardKind,
  amount: row.amount,
  dailyCap: row.dailyCap,
  params: row.params,
  active: row.active,
  createdAt: row.createdAt,
});

const notFound = (code: string) => new AppError(`${code} is not a reward rule`, 404, AppErrorCode.NOT_FOUND);

@Injectable()
export class RulesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  async list(actor: Actor, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const rows = await (tx ?? this.prisma).rewardRule.findMany();
    return { message: 'Reward rules', data: RULE_CATALOG.map((rule) => describeRule(rule, this.rowsOf(rows, rule.code))) };
  }

  async publish(actor: Actor, code: string, input: PublishRuleInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const rule = this.definitionOf(code);
    const values = this.validValues(rule, input.values);
    const plan: PublishInput = { baseVersion: input.baseVersion, values };
    return this.change(actor, rule, 'GAMIFY_RULE_PUBLISHED', input.reason, traceId, tx, (rows) => planPublish(rule, rows, plan), 'Reward rule published');
  }

  async activate(actor: Actor, code: string, version: number, input: ReasonInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const rule = this.definitionOf(code);
    return this.change(actor, rule, 'GAMIFY_RULE_ACTIVATED', input.reason, traceId, tx, (rows) => planActivate(rule, rows, version), 'Reward rule version activated');
  }

  async deactivate(actor: Actor, code: string, input: ReasonInput, traceId?: string, tx?: Prisma.TransactionClient) {
    this.policy.assertAdmin(actor);
    const rule = this.definitionOf(code);
    return this.change(actor, rule, 'GAMIFY_RULE_DEACTIVATED', input.reason, traceId, tx, (rows) => planDeactivate(rule, rows), 'Reward rule deactivated');
  }

  private async change(
    actor: Actor,
    rule: RuleDefinition,
    action: RuleAction,
    reason: string,
    traceId: string | undefined,
    tx: Prisma.TransactionClient | undefined,
    plan: (rows: StoredRule[]) => WritePlan,
    message: string,
  ) {
    const work = async (client: Prisma.TransactionClient) => {
      await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gamify-rule:${rule.code}`}))`;
      const before = (await client.rewardRule.findMany({ where: { code: rule.code } })).map(toStored);
      const writes = plan(before);

      if (writes.create.length > 0) {
        await client.rewardRule.createMany({
          data: writes.create.map((row) => ({
            code: row.code,
            version: row.version,
            eventType: row.eventType,
            rewardKind: row.rewardKind,
            amount: row.amount,
            dailyCap: row.dailyCap,
            params: (row.params ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            active: row.active,
          })),
        });
      }
      if (writes.deactivate.length > 0) {
        await client.rewardRule.updateMany({ where: { code: rule.code, version: { in: writes.deactivate } }, data: { active: false } });
      }
      if (writes.activate.length > 0) {
        await client.rewardRule.updateMany({ where: { code: rule.code, version: { in: writes.activate } }, data: { active: true } });
      }

      const after = (await client.rewardRule.findMany({ where: { code: rule.code } })).map(toStored);
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action,
          entityType: 'RewardRule',
          entityId: rule.code,
          before: { inForce: inForce(rule, before) } as unknown as Prisma.InputJsonValue,
          after: { inForce: inForce(rule, after) } as unknown as Prisma.InputJsonValue,
          reason,
          traceId,
        },
        client as unknown as Pick<PrismaService, 'auditLog'>,
      );
      return describeRule(rule, after);
    };

    const view: RuleView = await (tx ? work(tx) : this.prisma.$transaction(work));
    return { message, data: view };
  }

  private definitionOf(code: string): RuleDefinition {
    const rule = ruleDefinition(code);
    if (!rule) throw notFound(code);
    return rule;
  }

  private validValues(rule: RuleDefinition, values: Record<string, number>): Record<string, number> {
    const parsed = publishSchemaFor(rule).safeParse(values);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'values'}: ${issue.message}`).join('; ');
      throw new AppError(`The values are not valid for ${rule.code}: ${problems}`, 400, AppErrorCode.VALIDATION_ERROR);
    }
    return parsed.data as Record<string, number>;
  }

  private rowsOf(rows: RewardRule[], code: string): StoredRule[] {
    return rows.filter((row) => row.code === code).map(toStored);
  }
}
