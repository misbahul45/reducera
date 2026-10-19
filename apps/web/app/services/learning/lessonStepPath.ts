import type { PathStepGroup } from '~/lib/learning-path'
import { stepsService } from '~/services/curriculum/steps'
import { userStepService } from '~/services/learning/userStep'

export const PATH_STEP_LIMIT = 50
export const PATH_USER_STEP_LIMIT = 100

export async function fetchLessonStepGroups(lessonId: string, userId: string): Promise<PathStepGroup[]> {
  const templates = await stepsService.findAll({ page: 1, limit: PATH_STEP_LIMIT, lessonId, sort: 'sortOrder:asc' })
  const list = templates?.data?.data ?? []

  return Promise.all(
    list.map(async (template) => {
      const mine = await userStepService.findAll({ page: 1, limit: PATH_USER_STEP_LIMIT, stepTemplateId: template.id, userId, sort: 'order:asc' })
      return {
        id: template.id,
        title: template.title,
        sortOrder: template.sortOrder,
        steps: (mine?.data?.data ?? []).map((step) => ({
          id: step.id,
          title: step.title,
          order: step.order,
          isDone: step.isDone,
          isUnlocked: step.isUnlocked,
        })),
      }
    }),
  )
}
