ALTER TABLE "PromptVersion" ADD COLUMN "canaryPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_canary_range" CHECK ("canaryPercent" BETWEEN 0 AND 50);

ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_canary_needs_experimental" CHECK ("canaryPercent" = 0 OR "status" = 'EXPERIMENTAL');

CREATE UNIQUE INDEX "PromptVersion_one_active_per_name" ON "PromptVersion"("name") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "PromptVersion_one_canary_per_name" ON "PromptVersion"("name") WHERE "status" = 'EXPERIMENTAL';

CREATE FUNCTION "evaluation_dataset_frozen_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."isFrozen" THEN
    RAISE EXCEPTION 'A frozen evaluation dataset cannot be changed or removed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvaluationDataset_frozen_guard" BEFORE UPDATE OR DELETE ON "EvaluationDataset" FOR EACH ROW EXECUTE FUNCTION "evaluation_dataset_frozen_guard"();
