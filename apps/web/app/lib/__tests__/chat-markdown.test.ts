import { describe, expect, it } from 'vitest'
import { citationAnchor, renderChatMarkdown } from '~/lib/chat-markdown'

describe('renderChatMarkdown', () => {
  it('turns a valid marker into a link to its source', () => {
    const html = renderChatMarkdown('Kas itu aset [1].', [1], 'm1')

    expect(html).toContain(`<sup class="rc-cite"><a href="#${citationAnchor('m1', 1)}" aria-label="Sumber 1">1</a></sup>`)
    expect(html).not.toContain('[1]')
  })

  it('leaves a marker alone when there is no source of that number', () => {
    expect(renderChatMarkdown('Kas itu aset [7].', [1], 'm1')).toContain('[7]')
    expect(renderChatMarkdown('Kas itu aset [1].', [], 'm1')).toContain('[1]')
  })

  it('handles a group of numbers one by one and refuses a group with an unknown number', () => {
    const grouped = renderChatMarkdown('Ini [1, 2].', [1, 2], 'm1')
    expect(grouped.match(/<a href="#src-m1-\d"/g)).toHaveLength(2)
    expect(grouped).toContain('class="rc-cite-sep"')

    expect(renderChatMarkdown('Ini [1, 9].', [1, 2], 'm1')).toContain('[1, 9]')
  })

  it('turns markers written back to back into one link each', () => {
    const html = renderChatMarkdown('Total 160 soal [1][2][3]. Lalu [2][3].', [1, 2, 3], 'm1')

    expect(html.match(/<a href="#src-m1-\d"/g)).toHaveLength(5)
    expect(html).not.toContain('[1]')
    expect(html).not.toContain('[2]')
    expect(html).toContain('href="#src-m1-1"')
  })

  it('still leaves a marker alone when a named reference follows it', () => {
    const html = renderChatMarkdown('Lihat [1][aturan] dan [2][9].', [1, 2], 'm1')

    expect(html).toContain('[1][aturan]')
    expect(html.match(/<a href="#src-m1-\d"/g)).toHaveLength(1)
    expect(html).toContain('href="#src-m1-2"')
    expect(html).toContain('[9]')
  })

  it('does not touch a markdown link whose text is a number', () => {
    const html = renderChatMarkdown('Lihat [1](https://contoh.id).', [1], 'm1')

    expect(html).toContain('<a href="https://contoh.id"')
    expect(html).not.toContain('rc-cite')
  })

  it('opens ordinary links in a new tab without leaking the opener', () => {
    const html = renderChatMarkdown('Baca https://contoh.id/jurnal ya', [], 'm1')

    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('never renders raw html from the model or from the learner', () => {
    const html = renderChatMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [1]', [1], 'm1')

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps ordinary markdown working', () => {
    const html = renderChatMarkdown('**Aset** itu:\n\n- kas\n- piutang', [], 'm1')

    expect(html).toContain('<strong>Aset</strong>')
    expect(html).toContain('<li>kas</li>')
  })

  it('returns nothing for an empty text and makes anchors safe for the page', () => {
    expect(renderChatMarkdown('', [1], 'm1')).toBe('')
    expect(renderChatMarkdown(null, [1], 'm1')).toBe('')
    expect(citationAnchor('a"><b', 2)).toBe('src-ab-2')
  })
})
