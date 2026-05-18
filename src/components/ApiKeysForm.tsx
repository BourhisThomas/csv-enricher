'use client'

import { useState } from 'react'
import { useApiKeys } from './ApiKeysProvider'

type Provider = 'anthropic' | 'openai' | 'exa'

interface KeyCardProps {
  name: string
  subName: string
  href: string
  hrefLabel: string
  optional?: boolean
  placeholder: string
  value: string
  savedValue: string
  onChange: (v: string) => void
  onSave: () => void
  onClear: () => void
  statusOk?: { dot: boolean; text: string } | null
  statusEmpty?: string | null
}

function KeyCard({
  name,
  subName,
  href,
  hrefLabel,
  placeholder,
  value,
  savedValue,
  onChange,
  onSave,
  onClear,
  statusOk,
  statusEmpty,
}: KeyCardProps) {
  const hasSaved = !!savedValue
  const dirty = value !== savedValue
  return (
    <div className="key-card">
      <div className="top">
        <span className="name">
          {name} <span className="sub-name">{subName}</span>
        </span>
        <a href={href} target="_blank" rel="noreferrer" className="ext">
          {hrefLabel} ↗
        </a>
      </div>
      <input
        className="field field-mono"
        type="password"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {hasSaved && statusOk && (
        <div className="status ok">
          <span className="dot" />
          {statusOk.text}
        </div>
      )}
      {!hasSaved && statusEmpty && (
        <div className="status empty">
          <span className="dot" />
          {statusEmpty}
        </div>
      )}
      <div className="row-gap" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onSave}
          disabled={!dirty || !value.trim()}
          aria-disabled={!dirty || !value.trim()}
        >
          {hasSaved && !dirty ? 'Enregistré' : 'Enregistrer'}
        </button>
        {hasSaved && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClear}
            style={{ color: 'var(--cherry)', borderColor: 'var(--cherry)' }}
          >
            Oublier
          </button>
        )}
      </div>
    </div>
  )
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return key
  return `${key.slice(0, 12)}${'•'.repeat(Math.max(8, key.length - 16))}${key.slice(-4)}`
}

function FormBody() {
  const { anthropicKey, openaiKey, exaKey, setKeys } = useApiKeys()
  const [anthropicInput, setAnthropicInput] = useState(anthropicKey)
  const [openaiInput, setOpenaiInput] = useState(openaiKey)
  const [exaInput, setExaInput] = useState(exaKey)

  function saveOne(provider: Provider) {
    if (provider === 'anthropic') setKeys({ anthropic: anthropicInput.trim() })
    if (provider === 'openai') setKeys({ openai: openaiInput.trim() })
    if (provider === 'exa') setKeys({ exa: exaInput.trim() })
  }

  function clearOne(provider: Provider) {
    if (provider === 'anthropic') {
      setAnthropicInput('')
      setKeys({ anthropic: '' })
    } else if (provider === 'openai') {
      setOpenaiInput('')
      setKeys({ openai: '' })
    } else {
      setExaInput('')
      setKeys({ exa: '' })
    }
  }

  function forgetAll() {
    if (!confirm('Oublier toutes les clés ?')) return
    setAnthropicInput('')
    setOpenaiInput('')
    setExaInput('')
    setKeys({ anthropic: '', openai: '', exa: '' })
  }

  return (
    <>
      <div className="page-hero">
        <div className="eyebrow">Page III</div>
        <h1>Tes clés.</h1>
        <p className="sub">
          Stockées dans le <code>localStorage</code> de ton navigateur. Transmises en header HTTP uniquement au moment d&apos;un appel, vers Anthropic / OpenAI / Exa directement. Jamais sur nos serveurs.
        </p>
      </div>

      <div className="col2" style={{ gridTemplateColumns: '1fr 320px' }}>
        <section>
          <KeyCard
            name="Anthropic"
            subName="Claude Opus / Sonnet / Haiku"
            href="https://console.anthropic.com/settings/keys"
            hrefLabel="console.anthropic.com"
            placeholder="sk-ant-…"
            value={anthropicInput}
            savedValue={anthropicKey}
            onChange={setAnthropicInput}
            onSave={() => saveOne('anthropic')}
            onClear={() => clearOne('anthropic')}
            statusOk={anthropicKey ? { dot: true, text: `clé enregistrée · ${maskKey(anthropicKey)}` } : null}
            statusEmpty="aucune clé — les modèles Claude seront désactivés tant qu'elle est vide"
          />

          <KeyCard
            name="OpenAI"
            subName="GPT-5 / GPT-4.1"
            href="https://platform.openai.com/api-keys"
            hrefLabel="platform.openai.com"
            placeholder="sk-…"
            value={openaiInput}
            savedValue={openaiKey}
            onChange={setOpenaiInput}
            onSave={() => saveOne('openai')}
            onClear={() => clearOne('openai')}
            statusOk={openaiKey ? { dot: true, text: `clé enregistrée · ${maskKey(openaiKey)}` } : null}
            statusEmpty="aucune clé — les modèles GPT seront désactivés tant qu'elle est vide"
          />

          <KeyCard
            name="Exa"
            subName="recherche web · facultatif"
            href="https://dashboard.exa.ai/api-keys"
            hrefLabel="dashboard.exa.ai"
            optional
            placeholder="exa_…"
            value={exaInput}
            savedValue={exaKey}
            onChange={setExaInput}
            onSave={() => saveOne('exa')}
            onClear={() => clearOne('exa')}
            statusOk={exaKey ? { dot: true, text: `clé enregistrée · ${maskKey(exaKey)}` } : null}
            statusEmpty="optionnel · requis seulement pour la recherche site entreprise"
          />

          <div className="row-end" style={{ marginTop: 24 }}>
            <button type="button" className="btn btn-danger" onClick={forgetAll}>
              Tout oublier
            </button>
          </div>
        </section>

        <aside className="gutter">
          <div className="section" style={{ marginTop: 0 }}>
            <h2><span className="n">§</span>BYOK — pourquoi</h2>
          </div>

          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: '0 0 14px' }}>
            Pas de compte, pas de facture, pas de marge cachée. Tu paies <b>Anthropic</b> / <b>OpenAI</b> / <b>Exa</b> directement, au prix exact des tokens consommés.
          </p>

          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: '0 0 14px' }}>
            Les clés ne quittent ton navigateur qu&apos;au moment d&apos;un appel — et toujours vers le provider, jamais chez nous.
          </p>

          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0 }}>
            Tu peux purger toutes les clés et ton historique d&apos;un clic. <i>(Bouton ci-contre, rouge.)</i>
          </p>

          <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--paper-2)', borderLeft: '3px solid var(--ink)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
              À savoir
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
              L&apos;historique est <em>navigateur-bound</em>. Pas de synchro multi-machine. Si tu vides ton navigateur, tout part avec.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}

export default function ApiKeysForm() {
  const { isLoaded } = useApiKeys()
  if (!isLoaded) return (
    <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
      Chargement…
    </div>
  )
  return <FormBody />
}
