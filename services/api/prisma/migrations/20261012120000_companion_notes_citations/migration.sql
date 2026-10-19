CREATE TYPE "NoteSource" AS ENUM ('MANUAL', 'CHAT');

ALTER TABLE "ChatMessage" ADD COLUMN     "actions" JSONB,
ADD COLUMN     "citations" JSONB;

ALTER TABLE "Question" ADD COLUMN     "distractors" JSONB;

ALTER TABLE "StrategyOutcome" ADD COLUMN     "chunkClass" TEXT;

CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userStepId" TEXT,
    "chatMessageId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" "NoteSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Note_userId_createdAt_idx" ON "Note"("userId", "createdAt");

CREATE INDEX "Note_userStepId_idx" ON "Note"("userStepId");

CREATE INDEX "StrategyOutcome_userId_chunkClass_idx" ON "StrategyOutcome"("userId", "chunkClass");

ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Note" ADD CONSTRAINT "Note_userStepId_fkey" FOREIGN KEY ("userStepId") REFERENCES "UserStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Note" ADD CONSTRAINT "Note_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Note" ADD CONSTRAINT "Note_title_length" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200);

ALTER TABLE "Note" ADD CONSTRAINT "Note_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 8000);

ALTER TABLE "Note" ADD CONSTRAINT "Note_chat_source_has_message" CHECK ("source" <> 'CHAT' OR "chatMessageId" IS NOT NULL OR "userStepId" IS NOT NULL);

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_chunk_class_known" CHECK ("chunkClass" IS NULL OR "chunkClass" IN ('SHORT', 'MEDIUM', 'LONG'));
