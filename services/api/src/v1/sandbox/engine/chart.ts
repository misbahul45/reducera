import { ACCOUNT_TYPES, AccountType, ChartAccount, Side } from './types';

const CLASS_LABEL: Record<AccountType, string> = {
  ASSET: 'Aset',
  CONTRA_ASSET: 'Aset',
  LIABILITY: 'Kewajiban',
  EQUITY: 'Ekuitas',
  DRAWING: 'Ekuitas',
  SUMMARY: 'Ekuitas',
  REVENUE: 'Pendapatan',
  CONTRA_REVENUE: 'Pendapatan',
  EXPENSE: 'Beban',
  CONTRA_EXPENSE: 'Beban',
};

const BASE_OF: Partial<Record<AccountType, AccountType>> = {
  CONTRA_ASSET: 'ASSET',
  CONTRA_REVENUE: 'REVENUE',
  CONTRA_EXPENSE: 'EXPENSE',
  DRAWING: 'EQUITY',
};

export class Chart {
  private readonly byCode: Map<string, ChartAccount>;

  constructor(accounts: ChartAccount[]) {
    this.byCode = new Map();
    for (const account of accounts) {
      if (this.byCode.has(account.code)) throw new Error(`Duplicate account code ${account.code}`);
      if (!(ACCOUNT_TYPES as readonly string[]).includes(account.type)) throw new Error(`Unknown account type ${account.type}`);
      this.byCode.set(account.code, account);
    }
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): ChartAccount {
    const account = this.byCode.get(code);
    if (!account) throw new Error(`Unknown account ${code}`);
    return account;
  }

  nameOf(code: string): string {
    return this.get(code).name;
  }

  classOf(code: string): string {
    return CLASS_LABEL[this.get(code).type];
  }

  isContra(code: string): boolean {
    return BASE_OF[this.get(code).type] !== undefined;
  }

  isBaseOfContra(code: string): boolean {
    const type = this.get(code).type;
    return type === 'ASSET' || type === 'REVENUE' || type === 'EXPENSE' || type === 'EQUITY';
  }

  normalSide(code: string): Side | null {
    return this.get(code).normalSide;
  }

  all(): ChartAccount[] {
    return Array.from(this.byCode.values());
  }
}

export const classLabelOfType = (type: AccountType): string => CLASS_LABEL[type];
