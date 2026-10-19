CREATE TABLE "ProductConceptLink" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "articleId" TEXT,
    "classProductId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProductConceptLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductConceptLink_conceptId_status_idx" ON "ProductConceptLink"("conceptId", "status");

CREATE UNIQUE INDEX "ProductConceptLink_articleId_conceptId_key" ON "ProductConceptLink"("articleId", "conceptId");

CREATE UNIQUE INDEX "ProductConceptLink_classProductId_conceptId_key" ON "ProductConceptLink"("classProductId", "conceptId");

ALTER TABLE "ProductConceptLink" ADD CONSTRAINT "ProductConceptLink_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductConceptLink" ADD CONSTRAINT "ProductConceptLink_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductConceptLink" ADD CONSTRAINT "ProductConceptLink_classProductId_fkey" FOREIGN KEY ("classProductId") REFERENCES "ClassProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductConceptLink" ADD CONSTRAINT "ProductConceptLink_exactly_one_product"
    CHECK ((("articleId" IS NOT NULL)::int + ("classProductId" IS NOT NULL)::int) = 1);

CREATE FUNCTION product_concept_link_limit() RETURNS trigger AS $$
DECLARE
    linked integer;
BEGIN
    SELECT count(*) INTO linked FROM "ProductConceptLink"
    WHERE ("articleId" IS NOT NULL AND "articleId" = NEW."articleId")
       OR ("classProductId" IS NOT NULL AND "classProductId" = NEW."classProductId");
    IF linked >= 5 THEN
        RAISE EXCEPTION 'A product can carry at most 5 concept links' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_concept_link_limit_guard
    BEFORE INSERT ON "ProductConceptLink"
    FOR EACH ROW EXECUTE FUNCTION product_concept_link_limit();
