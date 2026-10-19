import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestAi } from '~/lib/ai'

const runtimeConfig = { aiInternalUrl: 'http://ai-api:3003', public: { AI_URL: 'http://localhost' } }

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('window', {})
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestAi in the browser', () => {
  it('counts the 200 answer of the queue as a success, the way the ai service really answers', async () => {
    const queued = { status: 'processing', task_id: 't-1', message: 'Content generation started' }
    vi.stubGlobal('$fetch', vi.fn(async () => queued))

    const result = await requestAi('/learning/chat', 'POST', { query: 'halo' })

    expect(result.success).toBe(true)
    expect(result.message).toBe('Content generation started')
    expect(result.meta?.statusCode).toBe(200)
  })

  it('keeps an answer that already carries the api envelope', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ success: true, message: 'ok', data: { id: 1 } })))

    const result = await requestAi<{ id: number }>('/anything', 'GET')

    expect(result).toMatchObject({ success: true, data: { id: 1 } })
  })

  it('reports a failed call as a failure', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw Object.assign(new Error('Bad Request'), { statusCode: 400, data: { message: 'bad body' } })
    }))

    const result = await requestAi('/learning/chat', 'POST', {})

    expect(result.success).toBe(false)
  })

  it('sends the idempotency key and the body the caller gave', async () => {
    const spy = vi.fn(async () => ({ status: 'processing' }))
    vi.stubGlobal('$fetch', spy)

    await requestAi('/learning/chat', 'POST', { query: 'halo' }, { 'Idempotency-Key': 'k-1' })

    const [path, options] = spy.mock.calls[0] as unknown as [string, any]
    expect(path).toBe('/ai/v1/learning/chat')
    expect(options.body).toEqual({ query: 'halo' })
    expect(options.headers['Idempotency-Key']).toBe('k-1')
    expect(options.credentials).toBe('include')
  })
})
