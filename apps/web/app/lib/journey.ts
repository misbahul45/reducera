import type { AiStage, StageState } from '~/lib/ai-stages'

export interface JourneyInput {
  introSaved: boolean
  introWriting: boolean
  introFailed: boolean
  introBusyElsewhere: boolean
  quizExists: boolean
  quizTaken: boolean
  quizTimedOut: boolean
  submitting: boolean
  stepsReady: boolean
  pathTimedOut: boolean
  quizSize: number
  stepCount: number
}

export type CalloutKind =
  | 'hidden'
  | 'preparing'
  | 'quiz-ready'
  | 'quiz-failed'
  | 'building-path'
  | 'path-failed'
  | 'path-ready'

export interface Callout {
  kind: CalloutKind
  title: string
  message: string
  actionLabel: string | null
}

export const QUIZ_WAIT_MS = 180_000
export const PATH_WAIT_MS = 180_000
export const STREAM_SILENCE_MS = 60_000
export const POLL_MS = 4_000

export const initialJourney = (): JourneyInput => ({
  introSaved: false,
  introWriting: false,
  introFailed: false,
  introBusyElsewhere: false,
  quizExists: false,
  quizTaken: false,
  quizTimedOut: false,
  submitting: false,
  stepsReady: false,
  pathTimedOut: false,
  quizSize: 0,
  stepCount: 0,
})

export function introCompleted(input: JourneyInput): boolean {
  return input.introSaved && !input.introWriting
}

export function quizStageState(input: JourneyInput): StageState {
  if (input.quizExists) return 'done'
  if (input.quizTimedOut) return 'failed'
  return introCompleted(input) ? 'active' : 'pending'
}

export function pathStageState(input: JourneyInput): StageState {
  if (input.stepsReady) return 'done'
  if (input.pathTimedOut) return 'failed'
  if (input.quizTaken) return 'active'
  return 'pending'
}

export function quizStage(input: JourneyInput): AiStage {
  const state = quizStageState(input)
  const detail =
    state === 'done'
      ? `Kuis siap: ${input.quizSize} soal dari materi tadi`
      : state === 'active'
        ? 'Soal latihan sedang disusun dari sumber yang sama'
        : state === 'failed'
          ? 'Kuis belum berhasil dibuat'
          : ''
  return {
    key: 'quiz',
    label: 'Menyusun kuis jalur belajar',
    state,
    detail,
    fact: state === 'done' ? { key: 'quiz', text: `${input.quizSize} soal siap`, tone: 'ok' } : null,
  }
}

export function pathStage(input: JourneyInput): AiStage {
  const state = pathStageState(input)
  const detail =
    state === 'done'
      ? `${input.stepCount} langkah belajar siap`
      : state === 'active'
        ? 'Langkah belajar disusun dari jawabanmu'
        : state === 'failed'
          ? 'Jalur belajar belum berhasil dibuat'
          : ''
  return {
    key: 'path',
    label: 'Menyusun jalur belajarmu',
    state,
    detail,
    fact: state === 'done' ? { key: 'path', text: `${input.stepCount} langkah`, tone: 'ok' } : null,
  }
}

export function callout(input: JourneyInput): Callout {
  if (!introCompleted(input)) return { kind: 'hidden', title: '', message: '', actionLabel: null }

  if (input.stepsReady) {
    return {
      kind: 'path-ready',
      title: 'Jalur belajarmu siap',
      message: `${input.stepCount} langkah sudah disusun sesuai jawabanmu.`,
      actionLabel: 'Mulai langkah pertama',
    }
  }
  if (input.quizTaken) {
    return input.pathTimedOut
      ? { kind: 'path-failed', title: 'Jalur belajar belum siap', message: 'Penyusunannya makan waktu lebih lama dari biasa.', actionLabel: 'Periksa lagi' }
      : { kind: 'building-path', title: 'Menyusun jalur belajarmu', message: 'Jawabanmu sedang diolah menjadi langkah belajar. Halaman ini terisi sendiri.', actionLabel: null }
  }
  if (input.quizExists) {
    return {
      kind: 'quiz-ready',
      title: 'Kuis jalur belajar siap',
      message: `${input.quizSize} soal simulasi, sekitar ${Math.max(3, Math.round(input.quizSize * 0.6))} menit. Jawabanmu menentukan langkah belajar berikutnya.`,
      actionLabel: 'Mulai kuis jalur belajar',
    }
  }
  if (input.quizTimedOut) {
    return { kind: 'quiz-failed', title: 'Kuis belum berhasil dibuat', message: 'Coba lagi sebentar lagi.', actionLabel: 'Coba lagi' }
  }
  return { kind: 'preparing', title: 'Menyiapkan kuis', message: 'Kuis disusun dari sumber course yang sama dengan materi tadi.', actionLabel: null }
}

export const waitExpired = (startedAt: number | null, now: number, limit: number): boolean =>
  startedAt !== null && now - startedAt >= limit
