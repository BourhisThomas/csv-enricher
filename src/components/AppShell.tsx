'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import { useApiKeys } from './ApiKeysProvider'
import { MASTHEAD_ISSUE } from '@/lib/version'

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatToday(): string {
  const raw = DATE_FORMAT.format(new Date())
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function subscribeNoop() {
  return () => {}
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { anthropicKey, openaiKey, exaKey, isLoaded } = useApiKeys()
  const today = useSyncExternalStore(subscribeNoop, formatToday, () => '')

  const isHome = pathname === '/'
  const isHistory = pathname === '/historique'
  const isSettings = pathname === '/settings'

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <div className="vol">
            Vol. I · N° {MASTHEAD_ISSUE} · Signé{' '}
            <a
              href="https://calendar.app.google/gy2kXtKy1avgdDLH7"
              target="_blank"
              rel="noreferrer"
              className="masthead-sig"
              title="Prendre un RDV"
            >
              Th. Bourhis
            </a>
          </div>
          <Link href="/" className="nom" style={{ textDecoration: 'none' }}>
            L&apos;<span className="accent">Enricher</span>
          </Link>
        </div>
        <div className="right">
          <span className="date">{today || ' '}</span>
          <span className="sub">BYOK · sans compte · sans serveur</span>
        </div>
      </header>
      <div className="mast-double" />

      <nav className="nav">
        <Link href="/" className={isHome ? 'active' : ''}>
          <span className="n">I.</span>Nouveau job
        </Link>
        <Link href="/historique" className={isHistory ? 'active' : ''}>
          <span className="n">II.</span>Historique
        </Link>
        <Link href="/settings" className={isSettings ? 'active' : ''}>
          <span className="n">III.</span>Réglages
        </Link>
        <span className="spacer" />
        {isLoaded && (
          <span className="status">
            clés :{' '}
            <span className={anthropicKey ? 'ok' : 'miss'}>
              Anthropic {anthropicKey ? '●' : '○'}
            </span>
            {' '}·{' '}
            <span className={openaiKey ? 'ok' : 'miss'}>
              OpenAI {openaiKey ? '●' : '○'}
            </span>
            {' '}·{' '}
            <span className={exaKey ? 'ok' : 'miss'}>
              Exa {exaKey ? '●' : '○'}
            </span>
          </span>
        )}
      </nav>

      <main>{children}</main>

      <footer className="colophon">
        <span>
          <b>L&apos;Enricher</b> &nbsp;—&nbsp; outil n° 1 de la boîte à outils
        </span>
        <span className="sig">
          —{' '}
          <a
            href="https://calendar.app.google/gy2kXtKy1avgdDLH7"
            target="_blank"
            rel="noreferrer"
          >
            Th. Bourhis
          </a>
        </span>
      </footer>
    </div>
  )
}
