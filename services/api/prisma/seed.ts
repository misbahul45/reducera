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

const SEED_ACCOUNTS: ReadonlyArray<SeedAccount> = [
  { email: "seed.student@reducera.local", name: "Seed Student", role: "STUDENT" },
  { email: "seed.teacher@reducera.local", name: "Seed Teacher", role: "TEACHER" },
  { email: "seed.reviewer@reducera.local", name: "Seed Reviewer", role: "REVIEWER" },
  { email: "seed.admin@reducera.local", name: "Seed Admin", role: "ADMIN" },
];

async function main(): Promise<void> {
  const password = validateSeedPassword(process.env.SEED_ACCOUNT_PASSWORD ?? "", "SEED_ACCOUNT_PASSWORD");
  await upsertSeedAccounts(prisma, SEED_ACCOUNTS, password);
  await prisma.$disconnect();
  await import("./seed-golden-graph");
  await import("./seed-theme");
  await import("./seed-gamify");
}

main().catch(async (error: unknown) => {
  console.error("seed failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});