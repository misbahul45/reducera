import { describe, expect, it } from 'vitest'
import {
  MESSAGE_MAX,
  QUICK_ACTIONS,
  actionLabel,
  actionRequestText,
  canSave,
  canSend,
  greeting,
  hostOf,
  isBusy,
  isRunnable,
  normalizeActions,
  normalizeCitations,
  groundingNote,
  safeHref,
  sourceLabel,
  viaLabels,
} from '~/lib/chat'

describe('isBusy', () => {
  it('is busy while the reply is waiting or being prepared', () => {
    expect(isBusy('PENDING')).toBe(true)
    expect(isBusy('PROCESSING')).toBe(true)
    expect(isBusy('COMPLETED')).toBe(false)
    expect(isBusy('FAILED')).toBe(false)
    expect(isBusy(undefined)).toBe(false)
  })
})

describe('actions', () => {
  it('names every action in plain Indonesian', () => {
    expect(actionLabel({ type: 'QUIZ', count: 5 })).toBe('Buat 5 soal latihan')
    expect(actionLabel({ type: 'IMPROVE_MATERIAL', instruction: 'SIMPLIFY' })).toBe('Sederhanakan materi')
    expect(actionLabel({ type: 'NOTE', title: 't', body: 'b' })).toBe('Simpan ke catatan')
    expect(actionLabel({ type: 'OPEN_QUIZ', quizId: 'q' })).toBe('Kerjakan soal latihan')
    expect(actionLabel({ type: 'OPEN_MATERIAL' })).toBe('Lihat materi terbaru')
  })

  it('runs only the two actions the server can run', () => {
    expect(isRunnable({ type: 'QUIZ', count: 5 })).toBe(true)
    expect(isRunnable({ type: 'IMPROVE_MATERIAL', instruction: 'EXAMPLE' })).toBe(true)
    expect(isRunnable({ type: 'NOTE', title: 't', body: 'b' })).toBe(false)
    expect(isRunnable({ type: 'OPEN_QUIZ', quizId: 'q' })).toBe(false)
  })

  it('says in the learner voice what was asked', () => {
    expect(actionRequestText({ type: 'QUIZ', count: 5 })).toBe('Tolong buatkan 5 soal latihan.')
    expect(actionRequestText({ type: 'QUIZ', count: 3, focus: 'jurnal' })).toBe('Tolong buatkan 3 soal latihan tentang jurnal.')
    expect(actionRequestText({ type: 'IMPROVE_MATERIAL', instruction: 'SHORTEN' })).toBe('Tolong ringkas materi ini.')
  })

  it('offers quick actions that are all runnable', () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThan(0)
    expect(QUICK_ACTIONS.every(isRunnable)).toBe(true)
  })
})

describe('normalizeActions', () => {
  it('keeps the valid actions of the closed set', () => {
    expect(
      normalizeActions([
        { type: 'QUIZ', count: 5, focus: ' jurnal ' },
        { type: 'IMPROVE_MATERIAL', instruction: 'DEEPEN' },
        { type: 'NOTE', title: 'Aset', body: 'Aset adalah harta.' },
        { type: 'OPEN_QUIZ', quizId: 'q-1' },
      ]),
    ).toEqual([
      { type: 'QUIZ', count: 5, focus: 'jurnal' },
      { type: 'IMPROVE_MATERIAL', instruction: 'DEEPEN', focus: undefined },
      { type: 'NOTE', title: 'Aset', body: 'Aset adalah harta.' },
      { type: 'OPEN_QUIZ', quizId: 'q-1' },
    ])
  })

  it('keeps the action that points back to the material', () => {
    expect(normalizeActions([{ type: 'OPEN_MATERIAL' }])).toEqual([{ type: 'OPEN_MATERIAL' }])
  })

  it.each([
    [{ type: 'DELETE_ACCOUNT' }],
    [{ type: 'QUIZ', count: 99 }],
    [{ type: 'QUIZ', count: 'lima' }],
    [{ type: 'IMPROVE_MATERIAL', instruction: 'ERASE' }],
    [{ type: 'NOTE', title: '', body: 'x' }],
    [{ type: 'OPEN_QUIZ' }],
    ['QUIZ'],
    [null],
  ])('drops %j', (item) => {
    expect(normalizeActions([item])).toEqual([])
  })

  it('accepts only an array and at most four items', () => {
    expect(normalizeActions(null)).toEqual([])
    expect(normalizeActions({ type: 'OPEN_MATERIAL' })).toEqual([])
    expect(normalizeActions(Array.from({ length: 9 }, () => ({ type: 'OPEN_MATERIAL' })))).toHaveLength(4)
  })
})

describe('links', () => {
  it('lets only web links through', () => {
    expect(safeHref('https://contoh.id/a?b=1')).toBe('https://contoh.id/a?b=1')
    expect(safeHref('http://contoh.id')).toBe('http://contoh.id/')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('bukan url')).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })

  it('shows the host without www', () => {
    expect(hostOf('https://www.contoh.id/jurnal')).toBe('contoh.id')
    expect(hostOf('javascript:x')).toBe('')
  })
})

describe('normalizeCitations', () => {
  it('keeps a material citation without a link and a web citation with a safe link', () => {
    const citations = normalizeCitations([
      { index: 1, kind: 'MATERIAL', title: 'Persamaan akuntansi', snippet: 'Aset = Liabilitas + Ekuitas', url: 'https://tidak.boleh' },
      { index: 2, kind: 'WEB', title: 'Jurnal umum', url: 'https://contoh.id/jurnal' },
    ])

    expect(citations).toHaveLength(2)
    expect(citations[0]!.url).toBeUndefined()
    expect(citations[1]!.url).toBe('https://contoh.id/jurnal')
  })

  it('drops a web citation link that is not http or https but keeps the citation', () => {
    const [citation] = normalizeCitations([{ index: 1, kind: 'WEB', title: 'x', url: 'javascript:alert(1)' }])

    expect(citation!.title).toBe('x')
    expect(citation!.url).toBeUndefined()
  })

  it.each([
    [{ index: 0, kind: 'WEB', title: 'x' }],
    [{ index: 1, kind: 'OTHER', title: 'x' }],
    [{ index: 1, kind: 'WEB', title: '   ' }],
    [{ index: 'a', kind: 'WEB', title: 'x' }],
    [7],
  ])('drops %j', (item) => {
    expect(normalizeCitations([item])).toEqual([])
  })

  it('keeps one citation per number', () => {
    expect(normalizeCitations([{ index: 1, kind: 'WEB', title: 'a' }, { index: 1, kind: 'WEB', title: 'b' }])).toHaveLength(1)
  })
})

describe('composer', () => {
  it('sends only a non-empty draft within the limit while no reply is pending', () => {
    expect(canSend('halo', false)).toBe(true)
    expect(canSend('   ', false)).toBe(false)
    expect(canSend('halo', true)).toBe(false)
    expect(canSend('x'.repeat(MESSAGE_MAX + 1), false)).toBe(false)
  })

  it('lets the learner save only a finished reply of CORE with some substance', () => {
    expect(canSave({ role: 'ASSISTANT', status: 'COMPLETED', text: 'Kas adalah aset lancar yang paling likuid.' })).toBe(true)
    expect(canSave({ role: 'ASSISTANT', status: 'COMPLETED', text: 'Oke!' })).toBe(false)
    expect(canSave({ role: 'USER', status: 'COMPLETED', text: 'Kas adalah aset lancar yang paling likuid.' })).toBe(false)
    expect(canSave({ role: 'ASSISTANT', status: 'PROCESSING', text: 'Kas adalah aset lancar yang paling likuid.' })).toBe(false)
  })

  it('greets by name when it knows one', () => {
    expect(greeting('Sari')).toContain('Hai Sari!')
    expect(greeting(null)).toMatch(/^Hai! /)
    expect(greeting('  ')).toMatch(/^Hai! /)
  })
})

describe('topic citations', () => {
  it('keeps the record a topic citation comes from and how it was found', () => {
    const [citation] = normalizeCitations([
      { index: 1, kind: 'TOPIC', title: 'Konsep: Persamaan Akuntansi', refType: 'CONCEPT', refId: 'c1', via: ['LEXICAL', 'WEIRD'], url: 'https://tidak.boleh' },
    ])

    expect(citation).toMatchObject({ kind: 'TOPIC', refType: 'CONCEPT', refId: 'c1', via: ['LEXICAL'] })
    expect(citation!.url).toBeUndefined()
  })

  it('ignores an unknown record type instead of showing it', () => {
    const [citation] = normalizeCitations([{ index: 1, kind: 'TOPIC', title: 'x', refType: 'SECRET', refId: 'c1' }])

    expect(citation!.refType).toBeUndefined()
  })

  it('says in plain words where a source comes from', () => {
    expect(sourceLabel({ kind: 'TOPIC', refType: 'CONCEPT' })).toBe('Konsep course · database')
    expect(sourceLabel({ kind: 'TOPIC', refType: 'RESOURCE' })).toBe('Sumber course · database')
    expect(sourceLabel({ kind: 'TOPIC' })).toBe('Sumber course · database')
    expect(sourceLabel({ kind: 'WEB', url: 'https://www.contoh.id/a' })).toBe('Web · contoh.id')
    expect(sourceLabel({ kind: 'MATERIAL' })).toBe('Materi ReduCera')
  })

  it('names how a source was found', () => {
    expect(viaLabels({ via: ['LEXICAL', 'SEMANTIC'] })).toEqual(['cocok kata kunci', 'cocok makna'])
    expect(viaLabels({})).toEqual([])
  })

  it('tells honestly whether a text is grounded in the topic database', () => {
    expect(groundingNote([])).toBe('Tidak ada sumber course yang dikutip untuk teks ini.')
    expect(groundingNote([{ index: 1, kind: 'TOPIC', title: 'x' }, { index: 2, kind: 'WEB', title: 'y' }])).toBe('2 sumber dikutip, 1 dari database course.')
    expect(groundingNote([{ index: 1, kind: 'WEB', title: 'y' }])).toBe('1 sumber dikutip.')
  })
})
