import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { upsertSeedAccounts, validateSeedPassword, type SeedAccount } from "./seed-account";

const connectionString = `${process.env.DATABASE_URL}`;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_EMAIL = "seed.learner@reducera.local";
const DEFAULT_NAME = "Seed Learner";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readAccount(): SeedAccount {
  const email = (process.env.SEED_USER_EMAIL?.trim() || DEFAULT_EMAIL).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("SEED_USER_EMAIL must be a valid email address");
  }
  return { email, name: process.env.SEED_USER_NAME?.trim() || DEFAULT_NAME, role: "STUDENT" };
}

function readPassword(): string {
  const own = process.env.SEED_USER_PASSWORD;
  return own
    ? validateSeedPassword(own, "SEED_USER_PASSWORD")
    : validateSeedPassword(process.env.SEED_ACCOUNT_PASSWORD ?? "", "SEED_ACCOUNT_PASSWORD");
}

async function main(): Promise<void> {
  const account = readAccount();
  await upsertSeedAccounts(prisma, [account], readPassword());
  console.log(`seeded learner ${account.email}`);
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error("seed user failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
