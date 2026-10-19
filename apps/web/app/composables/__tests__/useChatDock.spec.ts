import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { parseDock, useChatDock } from '~/composables/useChatDock'

describe('parseDock', () => {
  it('reads what was remembered', () => {
    expect(parseDock('{"open":true,"wide":true}')).toEqual({ open: true, wide: true })
    expect(parseDock('{"open":true}')).toEqual({ open: true, wide: false })
  })

  it.each([[null], [''], ['bukan json'], ['[]'], ['{"open":"yes","wide":1}']])('falls back to a closed panel for %j', (raw) => {
    expect(parseDock(raw)).toEqual({ open: false, wide: false })
  })
})

describe('useChatDock', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    const states: Record<string, unknown> = {
      'chat-dock': ref({ open: false, wide: false }),
      'chat-dock-available': ref(false),
    }
    vi.stubGlobal('useState', (key: string) => states[key])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
  })

  it('opens and closes the panel and remembers it for the next page', () => {
    const { dock, toggle, close } = useChatDock()

    toggle()
    expect(dock.value.open).toBe(true)
    expect(JSON.parse(store.get('rc-chat-dock')!)).toEqual({ open: true, wide: false })

    close()
    expect(dock.value.open).toBe(false)
    expect(JSON.parse(store.get('rc-chat-dock')!)).toEqual({ open: false, wide: false })
  })

  it('widens and narrows the panel without touching whether it is open', () => {
    const { dock, toggle, toggleWide } = useChatDock()
    toggle()

    toggleWide()
    expect(dock.value).toEqual({ open: true, wide: true })
    toggleWide()
    expect(dock.value).toEqual({ open: true, wide: false })
  })

  it('tells the layout whether the page has a chat to open', () => {
    const { available, setAvailable } = useChatDock()
    expect(available.value).toBe(false)

    setAvailable(true)
    expect(available.value).toBe(true)
    setAvailable(false)
    expect(available.value).toBe(false)
  })

  it('restores what the learner left and survives a browser that refuses storage', () => {
    store.set('rc-chat-dock', '{"open":true,"wide":true}')
    const { dock, restore } = useChatDock()

    restore()
    expect(dock.value).toEqual({ open: true, wide: true })

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => restore()).not.toThrow()
    expect(() => useChatDock().toggle()).not.toThrow()
  })
})
