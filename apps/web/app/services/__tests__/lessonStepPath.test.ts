import { beforeEach, describe, expect, it, vi } from 'vitest'

const findSteps = vi.fn()
const findUserSteps = vi.fn()

vi.mock('~/services/curriculum/steps', () => ({ stepsService: { findAll: (...args: unknown[]) => findSteps(...args) } }))
vi.mock('~/services/learning/userStep', () => ({ userStepService: { findAll: (...args: unknown[]) => findUserSteps(...args) } }))

import { PATH_STEP_LIMIT, PATH_USER_STEP_LIMIT, fetchLessonStepGroups } from '~/services/learning/lessonStepPath'

const template = (id: string, sortOrder: number) => ({ id, title: `Bagian ${id}`, sortOrder })
const mine = (id: string, order: number, isDone = false, isUnlocked = true) => ({ id, title: `Langkah ${id}`, order, isDone, isUnlocked, userId: 'u-1', createdAt: 'x' })

describe('fetchLessonStepGroups', () => {
  beforeEach(() => {
    findSteps.mockReset()
    findUserSteps.mockReset()
  })

  it('asks for the steps of the lesson in teaching order and the own steps of each one', async () => {
    findSteps.mockResolvedValue({ data: { data: [template('t1', 1), template('t2', 2)] } })
    findUserSteps.mockResolvedValue({ data: { data: [] } })

    await fetchLessonStepGroups('lesson-1', 'u-1')

    expect(findSteps).toHaveBeenCalledWith({ page: 1, limit: PATH_STEP_LIMIT, lessonId: 'lesson-1', sort: 'sortOrder:asc' })
    expect(findUserSteps).toHaveBeenCalledWith({ page: 1, limit: PATH_USER_STEP_LIMIT, stepTemplateId: 't1', userId: 'u-1', sort: 'order:asc' })
    expect(findUserSteps).toHaveBeenCalledWith({ page: 1, limit: PATH_USER_STEP_LIMIT, stepTemplateId: 't2', userId: 'u-1', sort: 'order:asc' })
  })

  it('keeps only what the path needs from each own step', async () => {
    findSteps.mockResolvedValue({ data: { data: [template('t1', 1)] } })
    findUserSteps.mockResolvedValue({ data: { data: [mine('a', 1, true), mine('b', 2, false, false)] } })

    const groups = await fetchLessonStepGroups('lesson-1', 'u-1')

    expect(groups).toEqual([
      {
        id: 't1',
        title: 'Bagian t1',
        sortOrder: 1,
        steps: [
          { id: 'a', title: 'Langkah a', order: 1, isDone: true, isUnlocked: true },
          { id: 'b', title: 'Langkah b', order: 2, isDone: false, isUnlocked: false },
        ],
      },
    ])
  })

  it('returns no groups when the lesson has no steps or the call fails', async () => {
    findSteps.mockResolvedValue({ data: { data: [] } })
    expect(await fetchLessonStepGroups('lesson-1', 'u-1')).toEqual([])

    findSteps.mockResolvedValue(undefined)
    expect(await fetchLessonStepGroups('lesson-1', 'u-1')).toEqual([])
  })

  it('treats a failed read of own steps as an empty section instead of failing the path', async () => {
    findSteps.mockResolvedValue({ data: { data: [template('t1', 1)] } })
    findUserSteps.mockResolvedValue({ success: false })

    expect(await fetchLessonStepGroups('lesson-1', 'u-1')).toEqual([{ id: 't1', title: 'Bagian t1', sortOrder: 1, steps: [] }])
  })
})
