import { describe, expect, it } from 'vitest'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, draftFromReply, noteDate, noteProblem, stepLink, stripMarkdown } from '~/lib/notes'

describe('noteProblem', () => {
  it('accepts a title and a body within the limits', () => {
    expect(noteProblem('Jurnal', 'Debit kas, kredit pendapatan.')).toBeNull()
  })

  it.each([
    ['', 'isi', 'Judul catatan wajib diisi.'],
    ['   ', 'isi', 'Judul catatan wajib diisi.'],
    ['judul', '  ', 'Isi catatan wajib diisi.'],
    ['x'.repeat(NOTE_TITLE_MAX + 1), 'isi', `Judul maksimal ${NOTE_TITLE_MAX} karakter.`],
    ['judul', 'x'.repeat(NOTE_BODY_MAX + 1), `Isi maksimal ${NOTE_BODY_MAX} karakter.`],
  ])('explains %j / %j', (title, body, message) => {
    expect(noteProblem(title, body)).toBe(message)
  })
})

describe('draftFromReply', () => {
  it('takes the first sentence as the title and keeps the whole reply as the body without citation markers', () => {
    const draft = draftFromReply('**Kas** itu aset lancar [1]. Ia paling mudah dicairkan.\n\n- contoh: uang tunai [2]')

    expect(draft.title).toBe('Kas itu aset lancar.')
    expect(draft.body).toContain('Ia paling mudah dicairkan.')
    expect(draft.body).not.toMatch(/\[\d\]/)
  })

  it('shortens a very long first sentence', () => {
    const draft = draftFromReply(`${'kata '.repeat(60)}selesai.`)

    expect(draft.title.length).toBeLessThanOrEqual(80)
    expect(draft.title.endsWith('…')).toBe(true)
  })

  it('has a title even for a reply that is only markup', () => {
    expect(draftFromReply('```\n```').title).toBe('Catatan dari CORE')
  })

  it('never exceeds the body limit', () => {
    expect(draftFromReply('a'.repeat(NOTE_BODY_MAX + 500)).body).toHaveLength(NOTE_BODY_MAX)
  })
})

describe('stripMarkdown', () => {
  it('removes the markup but keeps the words', () => {
    expect(stripMarkdown('## Judul\n\n**tebal** dan `kode` serta [tautan](https://x.id)')).toBe('Judul tebal dan kode serta tautan')
  })
})

describe('stepLink', () => {
  it('links to the step with the template id when it is known', () => {
    expect(stepLink({ userStepId: 'us-1', stepTemplateId: 'tpl-1' })).toBe('/my-learning/steps/tpl-1/us-1')
    expect(stepLink({ userStepId: 'us-1', stepTemplateId: null })).toBe('/my-learning/steps/us-1/us-1')
    expect(stepLink({ userStepId: null, stepTemplateId: null })).toBeNull()
  })
})

describe('noteDate', () => {
  it('prints an Indonesian date in the Jakarta time zone, the same on every machine', () => {
    expect(noteDate('2026-10-12T20:30:00Z')).toBe('13 Okt 2026')
  })

  it('prints nothing for a broken date', () => {
    expect(noteDate('bukan tanggal')).toBe('')
  })
})
