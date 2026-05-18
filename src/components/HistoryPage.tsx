'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteJob,
  JOB_TTL_MS,
  listJobs,
  pruneOldJobs,
  successCount,
  errorCount,
  type StoredJob,
} from '@/lib/storage/jobs'
import { computeCost, formatEur } from '@/lib/pricing'
import { getModel } from '@/lib/enricher/types'

type Filter = 'all' | 'complete' | 'interrupted' | 'error'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export default function HistoryPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<StoredJob[]>([])
  const [filter, setFilter] = useState<Filter>('all')

  const refresh = useCallback(async () => {
    try {
      const all = await listJobs()
      setJobs(all)
    } catch (err) {
      console.warn('[HISTORY] listJobs failed:', err)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await pruneOldJobs(JOB_TTL_MS)
      } catch (err) {
        console.warn('[HISTORY] prune failed:', err)
      }
      if (cancelled) return
      await refresh()
    })()
    return () => { cancelled = true }
  }, [refresh])

  const handleDelete = useCallback(async (jobId: string) => {
    await deleteJob(jobId)
    await refresh()
  }, [refresh])

  const handleDeleteAll = useCallback(async () => {
    if (!confirm('Effacer tout l\'historique ?')) return
    for (const j of jobs) {
      await deleteJob(j.id)
    }
    await refresh()
  }, [jobs, refresh])

  const counts = useMemo(() => {
    let complete = 0
    let interrupted = 0
    let error = 0
    for (const j of jobs) {
      const hasErrors = errorCount(j.results) > 0
      if (j.status === 'complete' && !hasErrors) complete++
      else if (j.status === 'running') interrupted++
      else if (j.status === 'complete' && hasErrors) error++
    }
    return { complete, interrupted, error, all: jobs.length }
  }, [jobs])

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    return jobs.filter(j => {
      const hasErrors = errorCount(j.results) > 0
      if (filter === 'complete') return j.status === 'complete' && !hasErrors
      if (filter === 'interrupted') return j.status === 'running'
      if (filter === 'error') return j.status === 'complete' && hasErrors
      return true
    })
  }, [jobs, filter])

  const totals = useMemo(() => {
    let lines = 0
    let cost = 0
    for (const j of jobs) {
      lines += j.rows.length
      if (j.usage) {
        const c = computeCost(j.config.model, j.usage)
        cost += c.total_eur
      }
    }
    return { lines, cost }
  }, [jobs])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 22, borderBottom: '1.5px solid var(--ink)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>
            Page II
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 88, lineHeight: 0.95, letterSpacing: '0.005em', margin: 0 }}>
            Historique.
          </h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="meta" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)' }}>
            {jobs.length} job{jobs.length > 1 ? 's' : ''} · {totals.lines.toLocaleString('fr-FR')} lignes · {formatEur(totals.cost)} sur 48 h
          </span>
          {jobs.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteAll}>
                Tout effacer
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '20px 0 4px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`tag ${filter === 'all' ? 'solid' : 'neutral'}`}
          style={{ cursor: 'pointer', border: filter === 'all' ? '1.5px solid var(--ink)' : '1.5px solid currentColor' }}
        >
          Tous · {counts.all}
        </button>
        <button
          type="button"
          onClick={() => setFilter('complete')}
          className={`tag ${filter === 'complete' ? 'solid' : 'neutral'}`}
          style={{ cursor: 'pointer' }}
        >
          Terminés · {counts.complete}
        </button>
        <button
          type="button"
          onClick={() => setFilter('interrupted')}
          className={`tag ${filter === 'interrupted' ? 'solid' : 'neutral'}`}
          style={{ cursor: 'pointer' }}
        >
          Interrompus · {counts.interrupted}
        </button>
        <button
          type="button"
          onClick={() => setFilter('error')}
          className={`tag ${filter === 'error' ? 'solid' : 'neutral'}`}
          style={{ cursor: 'pointer' }}
        >
          En erreur · {counts.error}
        </button>
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          Aucun job dans cette catégorie.
        </div>
      )}

      {filtered.map((job, idx) => {
        const total = job.rows.length
        const done = successCount(job.results)
        const errors = errorCount(job.results)
        const isComplete = job.status === 'complete' && errors === 0
        const isInterrupted = job.status === 'running'
        const isError = job.status === 'complete' && errors > 0
        const cost = job.usage ? computeCost(job.config.model, job.usage) : null
        const num = filtered.length - idx

        return (
          <div key={job.id} className="history-row">
            <span className="num">{String(num).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.fileName}
              </div>
              <div className="desc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.config.instruction || '—'}
              </div>
              <div className="meta">
                {formatDate(job.updatedAt)} · {done} / {total} ·{' '}
                {getModel(job.config.model)?.label ?? job.config.model}
                {job.config.exa_company_search && ' + Exa'}
              </div>
            </div>
            <div className="row-gap">
              {isComplete && <span className="tag green"><span className="dot" />terminé</span>}
              {isInterrupted && <span className="tag marigold"><span className="dot" />interrompu</span>}
              {isError && <span className="tag red"><span className="dot" />{errors} erreur{errors > 1 ? 's' : ''}</span>}
              <span className={`price ${cost ? '' : 'muted'}`}>
                {cost ? formatEur(cost.total_eur) : '—'}
              </span>
            </div>
            <div className="actions">
              {isInterrupted && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(`/?resume=${job.id}`)}>
                  ↻ Reprendre
                </button>
              )}
              {(isComplete || isError) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push(`/?view=${job.id}`)}>
                  Rouvrir
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleDelete(job.id)}
                style={{ color: 'var(--cherry)', borderColor: 'var(--cherry)' }}
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}
