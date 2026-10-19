CREATE TYPE "TryoutStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

CREATE TABLE "TryoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examKey" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "TryoutStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "plan" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "durationSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TryoutSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TryoutSession_userId_status_idx" ON "TryoutSession"("userId", "status");

CREATE INDEX "TryoutSession_userId_createdAt_idx" ON "TryoutSession"("userId", "createdAt");

ALTER TABLE "TryoutSession" ADD CONSTRAINT "TryoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TryoutSession_one_active_per_user" ON "TryoutSession"("userId") WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "TryoutSession" ADD CONSTRAINT "TryoutSession_duration_positive" CHECK ("durationSeconds" > 0);

ALTER TABLE "TryoutSession" ADD CONSTRAINT "TryoutSession_submitted_has_time" CHECK (("status" = 'SUBMITTED') = ("submittedAt" IS NOT NULL));
