import { PromptStatus } from '@prisma/client';
import { PROMPT_TRANSITIONS, assertPromptTransition, canTransitionPrompt } from '../prompt-state';

describe('prompt state table', () => {
  it('lets only a human decision reach ACTIVE and only from VALIDATED or an archived version', () => {
    const into = Object.values(PromptStatus).filter((from) => canTransitionPrompt(from, PromptStatus.ACTIVE));

    expect(into.sort()).toEqual([PromptStatus.ARCHIVED, PromptStatus.VALIDATED].sort());
  });

  it('never leaves a dead end open: rejected and rolled back versions stay final', () => {
    expect(PROMPT_TRANSITIONS.REJECTED).toEqual([]);
    expect(PROMPT_TRANSITIONS.ROLLED_BACK).toEqual([]);
  });

  it('requires a canary before validation and validation before activation', () => {
    expect(canTransitionPrompt(PromptStatus.DRAFT, PromptStatus.VALIDATED)).toBe(false);
    expect(canTransitionPrompt(PromptStatus.DRAFT, PromptStatus.ACTIVE)).toBe(false);
    expect(canTransitionPrompt(PromptStatus.EXPERIMENTAL, PromptStatus.ACTIVE)).toBe(false);
    expect(canTransitionPrompt(PromptStatus.EXPERIMENTAL, PromptStatus.VALIDATED)).toBe(true);
  });

  it('lets the active version be archived by a newer one or killed by a rollback', () => {
    expect(canTransitionPrompt(PromptStatus.ACTIVE, PromptStatus.ARCHIVED)).toBe(true);
    expect(canTransitionPrompt(PromptStatus.ACTIVE, PromptStatus.ROLLED_BACK)).toBe(true);
    expect(canTransitionPrompt(PromptStatus.ACTIVE, PromptStatus.DRAFT)).toBe(false);
  });

  it('answers 409 INVALID_STATE_TRANSITION for a move the table forbids', () => {
    expect(() => assertPromptTransition(PromptStatus.REJECTED, PromptStatus.ACTIVE)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'INVALID_STATE_TRANSITION' }),
    );
  });
});
