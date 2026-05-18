'use client'

import Link from 'next/link'
import type { StoredJob } from '@/lib/storage/jobs'
import { errorCount, successCount } from '@/lib/storage/jobs'

interface Props {
  jobs: StoredJob[]
  activeJobId: string | null
  liveProgress?: { current: number; total: number } | null
  onResume: (jobId: string, includeErrors: boolean) => void
  onView: (jobId: string) => void
  onDelete: (jobId: string) => void
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "à l'instant"
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `il y a ${diffHr} h`
  const diffDay = Math.floor(diffHr / 24)
  return `il y a ${diffDay} j`
}

function shortInstruction(job: StoredJob): string {
  const instr = job.config.instruction.trim()
  if (!instr) return '—'
  if (instr.length <= 48) return instr
  return instr.slice(0, 45) + '…'
}

export default function HistorySection({ jobs, activeJobId, liveProgress, onResume, onView, onDelete }: Props) {
  return (
    <aside className="gutter">
      <div className="section" style={{ marginTop: 0 }}>
        <h2><span className="n">§</span>Historique</h2>
        <Link className="meta" href="/historique" style={{ color: 'var(--ink-2)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          tout voir →
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
          Aucun job pour l&apos;instant. Lance ton premier batch et il apparaîtra ici.
        </p>
      ) : (
        <div className="job-list">
          {jobs.slice(0, 6).map(job => {
            const total = job.rows.length
            const done = successCount(job.results)
            const errors = errorCount(job.results)
            const isActive = activeJobId === job.id
            const isInterrupted = job.status === 'running' && !isActive
            const isComplete = job.status === 'complete'
            const pct = total > 0 ? Math.round(((isActive && liveProgress ? liveProgress.current : done) / total) * 100) : 0

            return (
              <div key={job.id} className={`job ${isActive ? 'live' : ''}`}>
                <div className="num-display">
                  {isActive && liveProgress ? liveProgress.current : total}
                  <small>{isActive && liveProgress ? `/ ${total}` : 'LIGNES'}</small>
                </div>
                <div>
                  <div className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.fileName}
                  </div>
                  <div className="desc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shortInstruction(job)}
                  </div>
                  <div className="tag-row">
                    {isActive && (
                      <span className="tag blue"><span className="dot" />en cours</span>
                    )}
                    {isInterrupted && (
                      <span className="tag marigold"><span className="dot" />interrompu</span>
                    )}
                    {isComplete && errors === 0 && (
                      <span className="tag green"><span className="dot" />terminé</span>
                    )}
                    {isComplete && errors > 0 && (
                      <span className="tag red"><span className="dot" />{errors} erreur{errors > 1 ? 's' : ''}</span>
                    )}
                    {!isActive && (
                      <span className="meta" style={{ margin: 0 }}>
                        {formatRelative(job.updatedAt)}
                      </span>
                    )}
                  </div>
                  {isActive && (
                    <>
                      <div className="mini-pbar" style={{ marginTop: 8 }}>
                        <div className="fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="meta">{pct}% · en direct</div>
                    </>
                  )}
                  {!isActive && (
                    <div className="tag-row" style={{ marginTop: 8 }}>
                      {isComplete && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onView(job.id)}>
                          Rouvrir
                        </button>
                      )}
                      {isInterrupted && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResume(job.id, true)}>
                          Reprendre
                        </button>
                      )}
                      {isComplete && errors > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResume(job.id, true)}>
                          Réessayer
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(job.id)}
                        style={{ background: 'transparent', border: 0, fontSize: 14, color: 'var(--ink-4)', cursor: 'pointer', padding: '4px' }}
                        aria-label="Supprimer"
                        title="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--ink-rule)' }}>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
          Stocké dans <code>IndexedDB</code>. TTL 48 h. Ferme l&apos;onglet quand tu veux — le job reprend depuis l&apos;historique.
        </p>
      </div>
    </aside>
  )
}
