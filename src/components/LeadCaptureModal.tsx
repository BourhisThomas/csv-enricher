'use client'

import { useEffect, useRef, useState } from 'react'
import { isFreeEmailDomain } from '@/lib/email/validate'

export type LeadPurpose = 'Mon entreprise' | 'Un client' | 'Curiosité' | 'Autre'
export type LeadUsage =
  | 'Vérifier listes prospection'
  | 'Remplacer Claygent'
  | 'Enrichir CRM'
  | 'Autre'

const PURPOSES: LeadPurpose[] = ['Mon entreprise', 'Un client', 'Curiosité', 'Autre']
const USAGES: LeadUsage[] = [
  'Vérifier listes prospection',
  'Remplacer Claygent',
  'Enrichir CRM',
  'Autre',
]

interface Props {
  open: boolean
  onClose: () => void
  onCaptured: (email: string) => void
}

function emailLooksValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).toLowerCase()
}

export default function LeadCaptureModal({ open, onClose, onCaptured }: Props) {
  const [email, setEmail] = useState('')
  const [purpose, setPurpose] = useState<LeadPurpose | null>(null)
  const [usage, setUsage] = useState<LeadUsage | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setError('')
      setTimeout(() => emailRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmedEmail = email.trim().toLowerCase()
  const emailValid = emailLooksValid(trimmedEmail)
  const domain = domainOf(trimmedEmail)
  const isFree = emailValid && isFreeEmailDomain(domain)
  const canSubmit = emailValid && !isFree && purpose && usage && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, purpose, usage }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = data?.error ?? 'unknown'
        setError(errorMessageFor(code))
        setSubmitting(false)
        return
      }
      onCaptured(trimmedEmail)
    } catch {
      setError('Erreur réseau. Réessaie dans un instant.')
      setSubmitting(false)
    }
  }

  return (
    <div className="lead-overlay" role="dialog" aria-modal="true" aria-labelledby="lead-title">
      <div className="lead-backdrop" onClick={onClose} />
      <div className="lead-card">
        <div className="lead-head">
          <span className="lead-eyebrow">Une dernière étape</span>
          <button type="button" className="lead-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <h2 id="lead-title" className="lead-title">
          Qui es-tu ?<br />
          <span className="accent">Trois infos rapides.</span>
        </h2>
        <p className="lead-sub">
          L&apos;outil est gratuit (tu payes tes clés API). En échange je voudrais juste savoir
          qui l&apos;utilise — ça m&apos;aide à l&apos;améliorer.
        </p>

        <form className="lead-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="lead-email">
              Email professionnel
            </label>
            <input
              ref={emailRef}
              id="lead-email"
              type="email"
              className="field"
              placeholder="prenom@entreprise.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            {email && !emailValid && (
              <span className="lead-hint err">Format d&apos;email invalide.</span>
            )}
            {emailValid && isFree && (
              <span className="lead-hint err">
                Email pro uniquement (pas {domain}). Utilise ton adresse @entreprise.
              </span>
            )}
          </div>

          <div className="field-group">
            <span className="field-label">C&apos;est pour qui ?</span>
            <div className="lead-radios">
              {PURPOSES.map(p => (
                <button
                  type="button"
                  key={p}
                  className={`lead-radio ${purpose === p ? 'on' : ''}`}
                  onClick={() => setPurpose(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <span className="field-label">Usage principal ?</span>
            <div className="lead-radios">
              {USAGES.map(u => (
                <button
                  type="button"
                  key={u}
                  className={`lead-radio ${usage === u ? 'on' : ''}`}
                  onClick={() => setUsage(u)}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="lead-error">{error}</div>
          )}

          <div className="lead-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!canSubmit}
            >
              {submitting ? 'Enregistrement…' : 'Continuer →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function errorMessageFor(code: string): string {
  switch (code) {
    case 'email_empty':
      return 'Email requis.'
    case 'email_invalid_format':
      return 'Format d\'email invalide.'
    case 'email_free_provider':
      return 'Email pro uniquement (pas Gmail, Outlook, etc.).'
    case 'invalid_purpose':
      return 'Choisis pour qui c\'est.'
    case 'invalid_usage':
      return 'Choisis ton usage principal.'
    case 'notion_not_configured':
      return 'Le serveur n\'est pas configuré. Contacte le support.'
    case 'notion_error':
      return 'Erreur côté serveur. Réessaie dans un instant.'
    default:
      return 'Erreur inattendue. Réessaie.'
  }
}
