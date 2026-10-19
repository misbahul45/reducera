export type CitationKind = 'MATERIAL' | 'WEB' | 'TOPIC'
export type CitationRefType = 'RESOURCE' | 'CONCEPT' | 'TOPIC' | 'SUBTOPIC'
export type CitationVia = 'LEXICAL' | 'SEMANTIC' | 'WEB' | 'SCOPE'

export interface ChatCitation {
  index: number
  kind: CitationKind
  title: string
  url?: string
  snippet?: string
  lessonId?: string
  refType?: CitationRefType
  refId?: string
  via?: CitationVia[]
}

export type ImproveInstruction = 'SIMPLIFY' | 'EXAMPLE' | 'DEEPEN' | 'SHORTEN'

export type QuizAction = { type: 'QUIZ'; count: number; focus?: string }
export type ImproveAction = { type: 'IMPROVE_MATERIAL'; instruction: ImproveInstruction; focus?: string }
export type NoteAction = { type: 'NOTE'; title: string; body: string }
export type OpenQuizAction = { type: 'OPEN_QUIZ'; quizId: string }
export type OpenMaterialAction = { type: 'OPEN_MATERIAL' }

export type ChatAction = QuizAction | ImproveAction | NoteAction | OpenQuizAction | OpenMaterialAction
export type RunnableAction = QuizAction | ImproveAction
