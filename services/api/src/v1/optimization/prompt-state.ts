import { PromptStatus } from '@prisma/client';
import { AppError, AppErrorCode } from '@/common/lib/error';

export const PROMPT_TRANSITIONS: Readonly<Record<PromptStatus, readonly PromptStatus[]>> = {
  [PromptStatus.DRAFT]: [PromptStatus.EXPERIMENTAL, PromptStatus.REJECTED],
  [PromptStatus.EXPERIMENTAL]: [PromptStatus.VALIDATED, PromptStatus.REJECTED, PromptStatus.ROLLED_BACK],
  [PromptStatus.VALIDATED]: [PromptStatus.ACTIVE, PromptStatus.REJECTED],
  [PromptStatus.ACTIVE]: [PromptStatus.ARCHIVED, PromptStatus.ROLLED_BACK],
  [PromptStatus.REJECTED]: [],
  [PromptStatus.ROLLED_BACK]: [],
  [PromptStatus.ARCHIVED]: [PromptStatus.ACTIVE],
};

export const canTransitionPrompt = (from: PromptStatus, to: PromptStatus): boolean => PROMPT_TRANSITIONS[from].includes(to);

export function assertPromptTransition(from: PromptStatus, to: PromptStatus): void {
  if (!canTransitionPrompt(from, to)) {
    throw new AppError(`A prompt version cannot move from ${from} to ${to}`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
  }
}

export const LIVE_PROMPT_STATES: readonly PromptStatus[] = [PromptStatus.ACTIVE, PromptStatus.EXPERIMENTAL];
