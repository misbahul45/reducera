import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REASON_MAX,
  REASON_MIN,
  auditActionLabel,
  canChangeAccount,
  canDecideTags,
  canaryProblem,
  contentActions,
  dayEndIso,
  dayStartIso,
  formatMillis,
  formatRate,
  gateLabel,
  prettyJson,
  evidenceProblem,
  EVIDENCE_MAX_BYTES,
  pageWindow,
  pendingTagsLabel,
  payoutActions,
  promptActions,
  reasonProblem,
  refundActions,
  roleLabel,
  statusMeta,
  TEMPLATE_OPTIONAL,
  TEMPLATE_REQUIRED,
  aiProposalProblem,
  templateProblem,
  tenantAction,
} from '~/lib/admin';

describe('reasonProblem', () => {
  it('asks for a reason when it is blank or too short', () => {
    expect(reasonProblem('')).toMatch(/wajib/i);
    expect(reasonProblem('   ')).toMatch(/wajib/i);
    expect(reasonProblem('ab')).toMatch(/minimal 3/i);
  });

  it('accepts a reason within the bounds the API enforces, after trimming', () => {
    expect(reasonProblem('abc')).toBeNull();
    expect(reasonProblem('  abc  ')).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX))).toBeNull();
  });

  it('refuses a reason above the maximum', () => {
    expect(reasonProblem('x'.repeat(REASON_MAX + 1))).toMatch(/maksimal 500/i);
    expect(REASON_MIN).toBe(3);
  });
});

describe('statusMeta', () => {
  it('labels and tones the statuses of every queue', () => {
    expect(statusMeta('payout', 'REQUESTED')).toEqual({ label: 'Diajukan', tone: 'warning' });
    expect(statusMeta('payout', 'PAID')).toEqual({ label: 'Dibayar', tone: 'success' });
    expect(statusMeta('refund', 'PROCESSED')).toEqual({ label: 'Selesai', tone: 'success' });
    expect(statusMeta('content', 'PENDING_REVIEW')).toEqual({ label: 'Menunggu tinjauan', tone: 'info' });
    expect(statusMeta('content', 'SUSPENDED').tone).toBe('warning');
    expect(statusMeta('tenant', 'SUSPENDED').tone).toBe('error');
    expect(statusMeta('application', 'PENDING').tone).toBe('warning');
    expect(statusMeta('payment', 'APPROVED').tone).toBe('success');
  });

  it('never throws on a status it does not know: shows it as it is, neutral', () => {
    expect(statusMeta('payout', 'SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', tone: 'neutral' });
  });
});

describe('payoutActions', () => {
  it('follows the payout state table', () => {
    expect(payoutActions('REQUESTED')).toEqual(['start-review', 'reject']);
    expect(payoutActions('UNDER_REVIEW')).toEqual(['approve', 'reject']);
    expect(payoutActions('APPROVED')).toEqual(['mark-paid', 'reject']);
  });

  it('offers nothing once a payout is final', () => {
    for (const status of ['PAID', 'REJECTED', 'CANCELLED']) expect(payoutActions(status)).toEqual([]);
  });
});

describe('refundActions', () => {
  it('follows the refund state table', () => {
    expect(refundActions('REQUESTED')).toEqual(['approve', 'reject']);
    expect(refundActions('APPROVED')).toEqual(['process', 'reject']);
    expect(refundActions('PROCESSED')).toEqual([]);
    expect(refundActions('REJECTED')).toEqual([]);
  });
});

describe('contentActions', () => {
  it('follows the content state table for moderation', () => {
    expect(contentActions('PENDING_REVIEW')).toEqual(['approve', 'reject']);
    expect(contentActions('PUBLISHED')).toEqual(['suspend', 'archive']);
    expect(contentActions('SUSPENDED')).toEqual(['reinstate', 'archive']);
    for (const status of ['DRAFT', 'REJECTED', 'ARCHIVED']) expect(contentActions(status)).toEqual([]);
  });
});

describe('tag decisions', () => {
  it('opens only for published content that has proposed tags', () => {
    expect(canDecideTags('PUBLISHED', 2)).toBe(true);
    expect(canDecideTags('PUBLISHED', 0)).toBe(false);
    expect(canDecideTags('PUBLISHED', undefined)).toBe(false);
    for (const status of ['PENDING_REVIEW', 'SUSPENDED', 'ARCHIVED', 'DRAFT', 'REJECTED']) expect(canDecideTags(status, 3)).toBe(false);
  });

  it('labels the waiting tag count and stays silent when there are none', () => {
    expect(pendingTagsLabel(3)).toBe('3 tag menunggu');
    expect(pendingTagsLabel(0)).toBe('');
    expect(pendingTagsLabel(undefined)).toBe('');
  });
});

describe('tenantAction', () => {
  it('offers the one move that makes sense for the current status', () => {
    expect(tenantAction('ACTIVE')).toBe('suspend');
    expect(tenantAction('SUSPENDED')).toBe('activate');
    expect(tenantAction('ARCHIVED')).toBeNull();
  });
});

describe('canChangeAccount', () => {
  it('never lets an administrator change their own role or activation', () => {
    expect(canChangeAccount('admin-1', 'admin-1')).toBe(false);
    expect(canChangeAccount('admin-1', 'user-2')).toBe(true);
  });

  it('is false when the signed-in user is unknown', () => {
    expect(canChangeAccount(undefined, 'user-2')).toBe(false);
  });
});

describe('roleLabel', () => {
  it('names the four roles and falls back to the raw value', () => {
    expect(roleLabel('STUDENT')).toBe('Pelajar');
    expect(roleLabel('TEACHER')).toBe('Guru');
    expect(roleLabel('REVIEWER')).toBe('Peninjau');
    expect(roleLabel('ADMIN')).toBe('Admin');
    expect(roleLabel('OTHER')).toBe('OTHER');
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('keeps first and last page and gaps marked, around the current page', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 18, 19, 20]);
  });

  it('never shows a gap marker for a single skipped page', () => {
    expect(pageWindow(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('is empty without pages', () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });
});

describe('auditActionLabel', () => {
  it('translates the known actions', () => {
    expect(auditActionLabel('USER_ROLE_CHANGED')).toBe('Peran pengguna diubah');
    expect(auditActionLabel('MANUAL_PAYMENT_APPROVED')).toBe('Pembayaran manual disetujui');
  });

  it('turns an unknown action into readable words instead of hiding it', () => {
    expect(auditActionLabel('WHATEVER_HAPPENED_NOW')).toBe('Whatever happened now');
    expect(auditActionLabel('tutor_explain')).toBe('Tutor explain');
  });
});

describe('evidenceProblem', () => {
  it('asks for a file when there is none', () => {
    expect(evidenceProblem(null)).toMatch(/unggah/i);
    expect(evidenceProblem(undefined)).toMatch(/unggah/i);
  });

  it('accepts an image up to the size the upload endpoint takes', () => {
    expect(evidenceProblem({ name: 'bukti.PNG', size: 1000 })).toBeNull();
    expect(evidenceProblem({ name: 'bukti.webp', size: EVIDENCE_MAX_BYTES })).toBeNull();
  });

  it('refuses a file that is not an image, too large, or empty', () => {
    expect(evidenceProblem({ name: 'bukti.pdf', size: 1000 })).toMatch(/gambar/i);
    expect(evidenceProblem({ name: 'bukti', size: 1000 })).toMatch(/gambar/i);
    expect(evidenceProblem({ name: 'bukti.png', size: EVIDENCE_MAX_BYTES + 1 })).toMatch(/4 MB/);
    expect(evidenceProblem({ name: 'bukti.png', size: 0 })).toMatch(/kosong/i);
  });
});

describe('dayStartIso and dayEndIso', () => {
  it('cover a whole day in Jakarta time', () => {
    expect(dayStartIso('2026-10-11')).toBe('2026-10-10T17:00:00.000Z');
    expect(dayEndIso('2026-10-11')).toBe('2026-10-11T16:59:59.999Z');
  });

  it('ignore anything that is not a real calendar day', () => {
    for (const value of ['', 'kemarin', '2026-13-01', '2026-02-30', '2026-1-1', '2026-10-11T00:00']) {
      expect(dayStartIso(value)).toBeUndefined();
      expect(dayEndIso(value)).toBeUndefined();
    }
  });
});

describe('prettyJson', () => {
  it('indents objects and is empty for nothing', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson(null)).toBe('');
    expect(prettyJson(undefined)).toBe('');
  });
});

describe('prompt governance helpers', () => {
  it('offers only the actions the state table allows for each status', () => {
    expect(promptActions('DRAFT')).toEqual(['canary', 'reject']);
    expect(promptActions('EXPERIMENTAL')).toEqual(['evaluate', 'reject']);
    expect(promptActions('VALIDATED')).toEqual(['approve', 'reject']);
    expect(promptActions('ACTIVE')).toEqual(['rollback']);
    expect(promptActions('REJECTED')).toEqual([]);
    expect(promptActions('ROLLED_BACK')).toEqual([]);
    expect(promptActions('ARCHIVED')).toEqual([]);
  });

  it('never offers approval before a candidate has passed the gate', () => {
    for (const status of ['DRAFT', 'EXPERIMENTAL', 'ACTIVE', 'REJECTED', 'ROLLED_BACK', 'ARCHIVED']) {
      expect(promptActions(status)).not.toContain('approve');
    }
  });

  it('gives every prompt, gate and run status a label and a tone', () => {
    for (const status of ['DRAFT', 'EXPERIMENTAL', 'VALIDATED', 'ACTIVE', 'REJECTED', 'ROLLED_BACK', 'ARCHIVED']) {
      expect(statusMeta('prompt', status).label).not.toBe(status);
    }
    for (const status of ['PASS', 'FAIL', 'INSUFFICIENT_DATA', 'NOT_MEASURED']) expect(statusMeta('gate', status).label).not.toBe(status);
    for (const status of ['PENDING', 'ACCEPTED', 'REJECTED', 'DEFERRED']) expect(statusMeta('optimizationRun', status).label).not.toBe(status);
  });

  it('keeps the canary share between 1 and 50 percent', () => {
    expect(canaryProblem(1)).toBeNull();
    expect(canaryProblem(50)).toBeNull();
    expect(canaryProblem(0)).toMatch(/1 sampai 50/);
    expect(canaryProblem(51)).toMatch(/1 sampai 50/);
    expect(canaryProblem(2.5)).toMatch(/bulat/);
  });

  const valid = `${'Ajarkan dengan teliti. '.repeat(12)} {{user_step_title}} {{domain_block}} {{learner_section}} {{user_input}} {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}}`;

  it('accepts a template with every required placeholder', () => {
    expect(templateProblem(valid)).toBeNull();
    expect(templateProblem(valid.replace('{{learner_section}}', ''))).toBeNull();
    expect(templateProblem(`${valid} {{learner_name}}`)).toBeNull();
  });

  it('requires the conversation and the current material like the API does', () => {
    expect(templateProblem(valid.replace('{{conversation}}', ''))).toMatch(/\{\{conversation\}\}/);
    expect(templateProblem(valid.replace('{{current_material}}', ''))).toMatch(/\{\{current_material\}\}/);
  });

  it('names the first thing wrong with a template', () => {
    expect(templateProblem('pendek')).toMatch(/minimal/);
    expect(templateProblem(valid.replace('{{rag}}', ''))).toMatch(/\{\{rag\}\}/);
    expect(templateProblem(`${valid} {{secret}}`)).toMatch(/tidak dikenal/);
    expect(templateProblem(`${valid} {{memory`)).toMatch(/rusak/);
  });

  it('formats rates and latencies and shows a dash for missing numbers', () => {
    expect(formatRate(0.567)).toBe('57%');
    expect(formatRate(null)).toBe('—');
    expect(formatMillis(850)).toBe('850 ms');
    expect(formatMillis(7373)).toBe('7.4 dtk');
    expect(formatMillis(undefined)).toBe('—');
  });

  it('labels each gate criterion in Indonesian and falls back to the id', () => {
    expect(gateLabel('learning_outcome')).toBe('Hasil belajar setelah jawaban');
    expect(gateLabel('unknown_criterion')).toBe('unknown_criterion');
  });
});

describe('the template contract of the web matches the API', () => {
  const source = readFileSync(resolve(__dirname, '../../../../../services/api/src/v1/optimization/prompt-contracts.ts'), 'utf8');
  const listOf = (key: string): string[] => {
    const block = source.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
    return [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1] as string);
  };

  it('has the same required and optional placeholders', () => {
    expect([...TEMPLATE_REQUIRED]).toEqual(listOf('required'));
    expect([...TEMPLATE_OPTIONAL]).toEqual(listOf('optional'));
  });
});

describe('aiProposalProblem', () => {
  it('turns the refusals of the API into plain Indonesian', () => {
    expect(aiProposalProblem('Only 6 turns of tutor-chat-builtin-3 are measured; an improvement needs at least 30.', 'x')).toBe(
      'Baru 6 jawaban dari tutor-chat-builtin-3 yang terukur. Usulan AI butuh minimal 30.',
    );
    expect(aiProposalProblem('There are already 3 AI proposals waiting for this prompt. Reject or start one of them first.', 'x')).toContain('Sudah ada 3 usulan AI');
    expect(aiProposalProblem('The proposal failed the safety checks: A protected sentence was removed: y', 'x')).toContain('tidak lolos pemeriksaan keamanan');
    expect(aiProposalProblem('The model proposed a template that failed the safety checks. Try again.', 'x')).toContain('tidak lolos pemeriksaan keamanan');
    expect(aiProposalProblem('The AI service could not produce a proposal right now. Try again later.', 'x')).toContain('belum bisa membuat usulan');
  });

  it('keeps any other message and falls back when there is none', () => {
    expect(aiProposalProblem('Forbidden resource', 'x')).toBe('Forbidden resource');
    expect(aiProposalProblem('', 'cadangan')).toBe('cadangan');
    expect(aiProposalProblem(null, 'cadangan')).toBe('cadangan');
  });
});
