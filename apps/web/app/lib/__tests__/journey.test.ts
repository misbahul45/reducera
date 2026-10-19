import { describe, expect, it } from 'vitest'
import { callout, initialJourney, introCompleted, pathStage, pathStageState, quizStage, quizStageState, waitExpired, type JourneyInput } from '~/lib/journey'

const at = (overrides: Partial<JourneyInput>): JourneyInput => ({ ...initialJourney(), ...overrides })

describe('callout', () => {
  it('shows nothing while the introduction is still being written, so no quiz can pop up mid generation', () => {
    expect(callout(at({ introWriting: true, quizExists: true })).kind).toBe('hidden')
    expect(callout(at({ introSaved: false, quizExists: true })).kind).toBe('hidden')
    expect(callout(initialJourney()).kind).toBe('hidden')
  })

  it('says the quiz is being prepared once the introduction is done and the quiz is not there yet', () => {
    const state = callout(at({ introSaved: true }))

    expect(state.kind).toBe('preparing')
    expect(state.actionLabel).toBeNull()
  })

  it('offers a button for the quiz only when it exists and the introduction is complete', () => {
    const state = callout(at({ introSaved: true, quizExists: true, quizSize: 10 }))

    expect(state.kind).toBe('quiz-ready')
    expect(state.actionLabel).toBe('Mulai kuis jalur belajar')
    expect(state.message).toContain('10 soal')
  })

  it('offers a retry when the quiz never arrived', () => {
    expect(callout(at({ introSaved: true, quizTimedOut: true }))).toMatchObject({ kind: 'quiz-failed', actionLabel: 'Coba lagi' })
  })

  it('does not offer the quiz again after it was taken and shows the path being built', () => {
    const state = callout(at({ introSaved: true, quizExists: true, quizTaken: true }))

    expect(state.kind).toBe('building-path')
    expect(state.actionLabel).toBeNull()
  })

  it('says when the path took too long and lets the learner check again', () => {
    expect(callout(at({ introSaved: true, quizExists: true, quizTaken: true, pathTimedOut: true }))).toMatchObject({
      kind: 'path-failed',
      actionLabel: 'Periksa lagi',
    })
  })

  it('offers the first step when the path exists, however it got there', () => {
    expect(callout(at({ introSaved: true, quizExists: true, quizTaken: true, stepsReady: true, stepCount: 3 }))).toMatchObject({
      kind: 'path-ready',
      actionLabel: 'Mulai langkah pertama',
    })
  })

  it('keeps the quiz time estimate sensible for a short quiz', () => {
    expect(callout(at({ introSaved: true, quizExists: true, quizSize: 3 })).message).toContain('3 menit')
  })
})

describe('stages', () => {
  it('waits for the introduction before the quiz stage starts, then runs, then finishes', () => {
    expect(quizStageState(at({ introWriting: true }))).toBe('pending')
    expect(quizStageState(at({ introSaved: true }))).toBe('active')
    expect(quizStageState(at({ introSaved: true, quizExists: true }))).toBe('done')
  })

  it('marks a quiz that never came as failed', () => {
    expect(quizStageState(at({ introSaved: true, quizTimedOut: true }))).toBe('failed')
  })

  it('says in plain words what each stage did and counts the real quiz and steps', () => {
    expect(quizStage(at({ introSaved: true, quizExists: true, quizSize: 10 })).detail).toBe('Kuis siap: 10 soal dari materi tadi')
    expect(quizStage(at({ introSaved: true, quizExists: true, quizSize: 10 })).fact?.text).toBe('10 soal siap')
    expect(pathStage(at({ stepsReady: true, stepCount: 4 })).detail).toBe('4 langkah belajar siap')
  })

  it('starts the path stage only after the quiz was taken', () => {
    expect(pathStageState(at({ quizExists: true }))).toBe('pending')
    expect(pathStageState(at({ quizTaken: true }))).toBe('active')
    expect(pathStageState(at({ quizTaken: true, pathTimedOut: true }))).toBe('failed')
    expect(pathStageState(at({ stepsReady: true }))).toBe('done')
  })
})

describe('introCompleted and waitExpired', () => {
  it('needs the text saved and no stream still writing', () => {
    expect(introCompleted(at({ introSaved: true }))).toBe(true)
    expect(introCompleted(at({ introSaved: true, introWriting: true }))).toBe(false)
    expect(introCompleted(at({}))).toBe(false)
  })

  it('expires a wait only after its limit and never before it started', () => {
    expect(waitExpired(null, 1_000_000, 100)).toBe(false)
    expect(waitExpired(1_000, 1_099, 100)).toBe(false)
    expect(waitExpired(1_000, 1_100, 100)).toBe(true)
  })
})
