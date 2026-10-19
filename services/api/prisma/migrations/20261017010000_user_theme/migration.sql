CREATE TABLE "UserTheme" (
    "userId" TEXT NOT NULL,
    "mood" TEXT[],
    "intensity" INTEGER NOT NULL,
    "tokens" JSONB NOT NULL,
    "atmosphere" JSONB NOT NULL,
    "variants" JSONB NOT NULL,
    "generatorVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTheme_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserTheme" ADD CONSTRAINT "UserTheme_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTheme" ADD CONSTRAINT "UserTheme_mood_count" CHECK (cardinality("mood") BETWEEN 1 AND 3);

ALTER TABLE "UserTheme" ADD CONSTRAINT "UserTheme_mood_known" CHECK ("mood" <@ ARRAY['calm', 'energetic', 'analytical', 'welcoming', 'playful', 'serious', 'mysterious', 'natural']::text[]);

ALTER TABLE "UserTheme" ADD CONSTRAINT "UserTheme_intensity_range" CHECK ("intensity" BETWEEN 0 AND 100);
