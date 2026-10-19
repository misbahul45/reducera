import { MISCONCEPTION_CODES, distractorCodeOf, isMisconceptionCode, tagDistractors } from '../misconception-codes';

describe('misconception codes', () => {
  it('has unique snake case codes', () => {
    expect(new Set(MISCONCEPTION_CODES).size).toBe(MISCONCEPTION_CODES.length);
    for (const code of MISCONCEPTION_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('recognises only codes of the closed list', () => {
    expect(isMisconceptionCode('debit_credit_swap')).toBe(true);
    expect(isMisconceptionCode('DEBIT_CREDIT_SWAP')).toBe(false);
    expect(isMisconceptionCode('rm -rf')).toBe(false);
    expect(isMisconceptionCode(undefined)).toBe(false);
  });

  describe('tagDistractors', () => {
    const options = ['Kas', 'Piutang', 'Utang', 'Modal'];

    it('keeps tags of wrong options with a known code', () => {
      expect(tagDistractors(options, 'Kas', { Piutang: 'normal_balance_confusion', Utang: 'debit_credit_swap' })).toEqual({
        Piutang: 'normal_balance_confusion',
        Utang: 'debit_credit_swap',
      });
    });

    it('drops the tag of the correct option, of a text that is not an option and of an unknown code', () => {
      expect(tagDistractors(options, 'Kas', { Kas: 'debit_credit_swap', Giro: 'debit_credit_swap', Modal: 'invented' })).toEqual({});
    });

    it('accepts missing tags', () => {
      expect(tagDistractors(options, 'Kas', undefined)).toEqual({});
    });
  });

  describe('distractorCodeOf', () => {
    it('returns the code of the chosen option and ignores what is not a plain tag map', () => {
      expect(distractorCodeOf({ B: 'debit_credit_swap' }, ' B ')).toBe('debit_credit_swap');
      expect(distractorCodeOf({ B: 'invented' }, 'B')).toBeNull();
      expect(distractorCodeOf({ B: 'debit_credit_swap' }, 'C')).toBeNull();
      expect(distractorCodeOf(null, 'B')).toBeNull();
      expect(distractorCodeOf(['debit_credit_swap'], 'B')).toBeNull();
      expect(distractorCodeOf({ B: 'debit_credit_swap' }, 7)).toBeNull();
    });
  });
});
