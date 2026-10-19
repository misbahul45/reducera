CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatAttachment_chatId_createdAt_idx" ON "ChatAttachment"("chatId", "createdAt");

CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_size_check" CHECK ("size" > 0 AND "size" <= 4194304 AND octet_length("data") = "size");

ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_mime_check" CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'));

ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_name_check" CHECK (char_length("name") BETWEEN 1 AND 200);
