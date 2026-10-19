export interface LearningIds {
  topicId: string;
  learningStyleId: string;
}

export interface LearningIdSources {
  topicIdOfLesson: (lessonId: string) => Promise<string | null | undefined>;
  learningStyleIdOf: (userId: string, topicId: string) => Promise<string | null | undefined>;
}

export async function resolveLearningIds(
  known: LearningIds,
  scope: { lessonId: string; userId: string },
  sources: LearningIdSources,
): Promise<LearningIds> {
  const topicId = known.topicId || (scope.lessonId ? ((await sources.topicIdOfLesson(scope.lessonId)) ?? '') : '');
  const learningStyleId =
    known.learningStyleId || (topicId && scope.userId ? ((await sources.learningStyleIdOf(scope.userId, topicId)) ?? '') : '');
  return { topicId, learningStyleId };
}

export function missingIdsProblem(ids: LearningIds): string | null {
  if (!ids.topicId) return 'Course untuk pelajaran ini belum ditemukan. Buka lagi pelajaran dari jalur belajarmu.';
  if (!ids.learningStyleId) return 'Gaya belajarmu belum diisi untuk course ini. Buka course-nya, jawab pertanyaan singkat tentang gaya belajarmu, lalu mulai pelajaran lagi.';
  return null;
}
