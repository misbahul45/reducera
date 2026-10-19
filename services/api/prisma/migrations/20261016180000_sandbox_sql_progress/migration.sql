CREATE TABLE "SandboxSqlProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "solved" BOOLEAN NOT NULL DEFAULT false,
    "solvedAt" TIMESTAMP(3),
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "lastSql" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxSqlProgress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SandboxSqlProgress_userId_solved_idx" ON "SandboxSqlProgress"("userId", "solved");

CREATE UNIQUE INDEX "SandboxSqlProgress_userId_exerciseId_key" ON "SandboxSqlProgress"("userId", "exerciseId");

ALTER TABLE "SandboxSqlProgress" ADD CONSTRAINT "SandboxSqlProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
