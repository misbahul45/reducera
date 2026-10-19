import type { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 12;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

export interface SeedAccount {
  email: string;
  name: string;
  role: Role;
}

export function validateSeedPassword(password: string, variable: string): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed accounts must not be created with NODE_ENV=production");
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`${variable} must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`);
  }
  return password;
}

export async function upsertSeedAccounts(
  prisma: PrismaClient,
  accounts: ReadonlyArray<SeedAccount>,
  plainPassword: string,
): Promise<void> {
  const password = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        role: account.role,
        password,
        emailVerified: new Date(),
        isActive: true,
      },
      create: {
        ...account,
        password,
        emailVerified: new Date(),
      },
    });
  }
}
