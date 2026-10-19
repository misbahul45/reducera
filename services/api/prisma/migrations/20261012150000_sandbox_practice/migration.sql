CREATE TYPE "SandboxPracticeStatus" AS ENUM ('IN_PROGRESS', 'SOLVED');

CREATE TABLE "SandboxPractice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "status" "SandboxPracticeStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hintLevel" INTEGER NOT NULL DEFAULT 0,
    "hintAt" TIMESTAMP(3),
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "solvedAt" TIMESTAMP(3),
    "solvedUnaided" BOOLEAN NOT NULL DEFAULT false,
    "lastLines" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxPractice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SandboxCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "findingCodes" TEXT[],
    "hintLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SandboxPractice_userId_status_idx" ON "SandboxPractice"("userId", "status");

CREATE INDEX "SandboxPractice_userId_updatedAt_idx" ON "SandboxPractice"("userId", "updatedAt");

CREATE UNIQUE INDEX "SandboxPractice_userId_scenarioId_key" ON "SandboxPractice"("userId", "scenarioId");

CREATE INDEX "SandboxCheck_userId_scenarioId_createdAt_idx" ON "SandboxCheck"("userId", "scenarioId", "createdAt");

CREATE INDEX "SandboxCheck_userId_createdAt_idx" ON "SandboxCheck"("userId", "createdAt");

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SandboxCheck" ADD CONSTRAINT "SandboxCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_attempts_check" CHECK ("attempts" >= 0);

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_bestScore_check" CHECK ("bestScore" >= 0 AND "bestScore" <= 1);

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_hintLevel_check" CHECK ("hintLevel" BETWEEN 0 AND 3);

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_solved_check" CHECK (("status" = 'SOLVED') = ("solvedAt" IS NOT NULL));

ALTER TABLE "SandboxPractice" ADD CONSTRAINT "SandboxPractice_unaided_check" CHECK (NOT "solvedUnaided" OR ("solvedAt" IS NOT NULL AND NOT "revealed"));

ALTER TABLE "SandboxCheck" ADD CONSTRAINT "SandboxCheck_attemptNumber_check" CHECK ("attemptNumber" >= 1);

ALTER TABLE "SandboxCheck" ADD CONSTRAINT "SandboxCheck_score_check" CHECK ("score" >= 0 AND "score" <= 1);

ALTER TABLE "SandboxCheck" ADD CONSTRAINT "SandboxCheck_hintLevel_check" CHECK ("hintLevel" BETWEEN 0 AND 3);

ALTER TABLE "SandboxCheck" ADD CONSTRAINT "SandboxCheck_lines_check" CHECK (jsonb_typeof("lines") = 'array' AND jsonb_array_length("lines") BETWEEN 1 AND 12);

CREATE FUNCTION guard_sandbox_check() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sandbox checks are append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SandboxCheck_guard" BEFORE UPDATE ON "SandboxCheck" FOR EACH ROW EXECUTE FUNCTION guard_sandbox_check();
