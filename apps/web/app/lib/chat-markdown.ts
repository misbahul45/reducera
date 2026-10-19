import MarkdownIt from 'markdown-it'

export interface CitationEnv {
  citations?: { valid: ReadonlySet<number>; prefix: string }
}

const MARKER = /^\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/
const SAFE_PREFIX = /[^a-zA-Z0-9_-]/g

export const citationAnchor = (prefix: string, index: number): string => `src-${prefix.replace(SAFE_PREFIX, '')}-${index}`

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

md.inline.ruler.before('link', 'citation', (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x5b) return false

  const match = MARKER.exec(state.src.slice(start))
  if (!match) return false
  const after = start + match[0].length
  const following = state.src.charAt(after)
  if (following === '(' || (following === '[' && !MARKER.test(state.src.slice(after)))) return false

  const env = state.env as CitationEnv
  if (!env.citations) return false
  const numbers = match[1]!.split(',').map((part) => Number(part.trim()))
  if (!numbers.every((number) => env.citations!.valid.has(number))) return false

  if (!silent) {
    numbers.forEach((number, position) => {
      const token = state.push('html_inline', '', 0)
      const separator = position > 0 ? '<sup class="rc-cite-sep" aria-hidden="true">,</sup>' : ''
      token.content = `${separator}<sup class="rc-cite"><a href="#${citationAnchor(env.citations!.prefix, number)}" aria-label="Sumber ${number}">${number}</a></sup>`
    })
  }
  state.pos = start + match[0].length
  return true
})

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, env, self)
}

export function renderChatMarkdown(text: string | null | undefined, validIndexes: readonly number[], prefix: string): string {
  if (!text) return ''
  const env: CitationEnv = { citations: { valid: new Set(validIndexes), prefix } }
  return md.render(text, env)
}
