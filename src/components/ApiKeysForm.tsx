'use client'

import { useState } from 'react'
import { useApiKeys } from './ApiKeysProvider'

function FormBody() {
  const { anthropicKey, openaiKey, setKeys } = useApiKeys()
  const [anthropicInput, setAnthropicInput] = useState(anthropicKey)
  const [openaiInput, setOpenaiInput] = useState(openaiKey)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  function handleSave() {
    setKeys({ anthropic: anthropicInput.trim(), openai: openaiInput.trim() })
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(null), 2500)
  }

  function handleClear(provider: 'anthropic' | 'openai') {
    if (provider === 'anthropic') {
      setAnthropicInput('')
      setKeys({ anthropic: '' })
    } else {
      setOpenaiInput('')
      setKeys({ openai: '' })
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Clés API</h1>
        <p className="text-sm text-gray-600">
          Tes clés sont stockées dans le <code>localStorage</code> de ton navigateur. Elles ne sont
          envoyées qu&apos;au backend Next.js de cette app, qui les utilise pour appeler Anthropic
          ou OpenAI directement (rien n&apos;est persisté côté serveur).
        </p>
      </div>

      <div className="space-y-2">
        <label className="block">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-medium">Clé Anthropic</span>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Obtenir une clé →
            </a>
          </div>
          <input
            type="password"
            value={anthropicInput}
            onChange={e => setAnthropicInput(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full px-3 py-2 border rounded font-mono text-sm"
            autoComplete="off"
          />
        </label>
        {anthropicKey && (
          <button
            onClick={() => handleClear('anthropic')}
            className="text-xs text-red-600 hover:underline"
          >
            Supprimer la clé Anthropic
          </button>
        )}
      </div>

      <div className="space-y-2">
        <label className="block">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-medium">Clé OpenAI</span>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Obtenir une clé →
            </a>
          </div>
          <input
            type="password"
            value={openaiInput}
            onChange={e => setOpenaiInput(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 border rounded font-mono text-sm"
            autoComplete="off"
          />
        </label>
        {openaiKey && (
          <button
            onClick={() => handleClear('openai')}
            className="text-xs text-red-600 hover:underline"
          >
            Supprimer la clé OpenAI
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
        >
          Enregistrer
        </button>
        {savedAt && <span className="text-sm text-green-700">✓ Enregistré</span>}
      </div>
    </div>
  )
}

export default function ApiKeysForm() {
  const { isLoaded } = useApiKeys()
  if (!isLoaded) return <div className="p-6 text-sm text-gray-500">Chargement...</div>
  return <FormBody />
}
