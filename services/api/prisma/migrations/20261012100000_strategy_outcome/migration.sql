CREATE TABLE "StrategyOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "scoreBefore" DOUBLE PRECISION NOT NULL,
    "scoreAfter" DOUBLE PRECISION NOT NULL,
    "scoreDelta" DOUBLE PRECISION NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategyOutcome_episodeId_key" ON "StrategyOutcome"("episodeId");

CREATE UNIQUE INDEX "StrategyOutcome_eventKey_key" ON "StrategyOutcome"("eventKey");

CREATE INDEX "StrategyOutcome_userId_strategy_idx" ON "StrategyOutcome"("userId", "strategy");

CREATE INDEX "StrategyOutcome_promptVersion_createdAt_idx" ON "StrategyOutcome"("promptVersion", "createdAt");

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_scores_in_unit_range" CHECK ("scoreBefore" BETWEEN 0 AND 1 AND "scoreAfter" BETWEEN 0 AND 1);

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_delta_matches_scores" CHECK (abs("scoreDelta" - ("scoreAfter" - "scoreBefore")) < 0.000001);

ALTER TABLE "StrategyOutcome" ADD CONSTRAINT "StrategyOutcome_success_means_improved" CHECK ("success" = ("scoreDelta" > 0));

CREATE FUNCTION "strategy_outcome_no_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StrategyOutcome is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StrategyOutcome_no_update" BEFORE UPDATE ON "StrategyOutcome" FOR EACH ROW EXECUTE FUNCTION "strategy_outcome_no_update"();
