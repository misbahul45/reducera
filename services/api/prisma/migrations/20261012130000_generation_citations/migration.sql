ALTER TABLE "LessonProgress" ADD COLUMN     "introductionCitations" JSONB;

ALTER TABLE "PersonalityQuiz" ADD COLUMN     "sources" JSONB;

ALTER TABLE "Question" ADD COLUMN     "sources" JSONB;
