'use client'

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

const ANTHROPIC_KEY_STORAGE = 'csv_enricher_anthropic_api_key'
const OPENAI_KEY_STORAGE = 'csv_enricher_openai_api_key'
const EXA_KEY_STORAGE = 'csv_enricher_exa_api_key'

interface ApiKeysContextValue {
  anthropicKey: string
  openaiKey: string
  exaKey: string
  setKeys: (keys: { anthropic?: string; openai?: string; exa?: string }) => void
  isLoaded: boolean
}

const ApiKeysContext = createContext<ApiKeysContextValue | null>(null)

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === ANTHROPIC_KEY_STORAGE ||
      e.key === OPENAI_KEY_STORAGE ||
      e.key === EXA_KEY_STORAGE
    ) {
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function notify() {
  for (const l of listeners) l()
}

function readKey(name: string): string {
  try {
    return localStorage.getItem(name) ?? ''
  } catch {
    return ''
  }
}

export function ApiKeysProvider({ children }: { children: React.ReactNode }) {
  const anthropicKey = useSyncExternalStore(
    subscribe,
    () => readKey(ANTHROPIC_KEY_STORAGE),
    () => '',
  )
  const openaiKey = useSyncExternalStore(
    subscribe,
    () => readKey(OPENAI_KEY_STORAGE),
    () => '',
  )
  const exaKey = useSyncExternalStore(
    subscribe,
    () => readKey(EXA_KEY_STORAGE),
    () => '',
  )
  const isLoaded = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  const setKeys = useCallback((keys: { anthropic?: string; openai?: string; exa?: string }) => {
    try {
      if (keys.anthropic !== undefined) {
        if (keys.anthropic) localStorage.setItem(ANTHROPIC_KEY_STORAGE, keys.anthropic)
        else localStorage.removeItem(ANTHROPIC_KEY_STORAGE)
      }
      if (keys.openai !== undefined) {
        if (keys.openai) localStorage.setItem(OPENAI_KEY_STORAGE, keys.openai)
        else localStorage.removeItem(OPENAI_KEY_STORAGE)
      }
      if (keys.exa !== undefined) {
        if (keys.exa) localStorage.setItem(EXA_KEY_STORAGE, keys.exa)
        else localStorage.removeItem(EXA_KEY_STORAGE)
      }
    } catch {}
    notify()
  }, [])

  return (
    <ApiKeysContext.Provider value={{ anthropicKey, openaiKey, exaKey, setKeys, isLoaded }}>
      {children}
    </ApiKeysContext.Provider>
  )
}

export function useApiKeys() {
  const ctx = useContext(ApiKeysContext)
  if (!ctx) throw new Error('useApiKeys must be used within ApiKeysProvider')
  return ctx
}
