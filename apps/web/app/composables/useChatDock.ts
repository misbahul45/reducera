const STORAGE_KEY = 'rc-chat-dock'

export interface ChatDockState {
  open: boolean
  wide: boolean
}

export function parseDock(raw: string | null): ChatDockState {
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<ChatDockState>
    return { open: value.open === true, wide: value.wide === true }
  } catch {
    return { open: false, wide: false }
  }
}

export function useChatDock() {
  const dock = useState<ChatDockState>('chat-dock', () => ({ open: false, wide: false }))
  const available = useState<boolean>('chat-dock-available', () => false)

  const remember = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dock.value))
    } catch {
      return
    }
  }

  const restore = () => {
    try {
      dock.value = parseDock(localStorage.getItem(STORAGE_KEY))
    } catch {
      return
    }
  }

  const toggle = () => {
    dock.value = { ...dock.value, open: !dock.value.open }
    remember()
  }

  const show = () => {
    dock.value = { ...dock.value, open: true }
    remember()
  }

  const close = () => {
    dock.value = { ...dock.value, open: false }
    remember()
  }

  const toggleWide = () => {
    dock.value = { ...dock.value, wide: !dock.value.wide }
    remember()
  }

  const setAvailable = (value: boolean) => {
    available.value = value
  }

  return { dock, available, toggle, show, close, toggleWide, restore, setAvailable }
}
