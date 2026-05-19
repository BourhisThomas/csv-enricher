'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import EnricherForm, { type InitialFormState } from '@/components/EnricherForm'
import EnricherPreview from '@/components/EnricherPreview'
import HistorySection from '@/components/HistorySection'
import LeadCaptureModal from '@/components/LeadCaptureModal'
import { useApiKeys } from '@/components/ApiKeysProvider'
import { computeCost, formatEur } from '@/lib/pricing'
import { getModel, getModelProvider } from '@/lib/enricher/types'
import {
  deleteJob,
  findMissingIndexes,
  getJob,
  JOB_TTL_MS,
  listJobs,
  newJobId,
  pruneOldJobs,
  saveJob,
  type StoredJob,
} from '@/lib/storage/jobs'
import type {
  ApiUsage,
  CsvRow,
  EnrichmentConfig,
  EnrichmentResult,
  EnrichmentStreamEvent,
  FieldMapping,
} from '@/lib/enricher/types'

type PageState = 'idle' | 'testing' | 'preview' | 'generating' | 'complete' | 'error'

const PERSIST_DEBOUNCE_MS = 1500
const LEAD_EMAIL_STORAGE_KEY = 'csv-enricher:lead-email'
const IS_DEV = process.env.NODE_ENV === 'development'

class HttpStreamError extends Error {
  code: string
  data: Record<string, unknown>
  status: number
  constructor(status: number, code: string, data: Record<string, unknown>) {
    super(code || `HTTP ${status}`)
    this.status = status
    this.code = code
    this.data = data
  }
}

function escapeCsv(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"'
  }
  return val
}

function downloadCsv(
  rows: CsvRow[],
  results: EnrichmentResult[],
  originalHeaders: string[],
  originalFileName: string,
) {
  const hasReasoning = results.some(r => r.reasoning !== undefined)
  const extraCols = hasReasoning ? ['Output', 'Reasoning'] : ['Output']
  const headers = [...originalHeaders, ...extraCols]

  const csvLines: string[] = [headers.map(escapeCsv).join(',')]
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const result = results.find(r => r.row_index === i)
    const baseValues = originalHeaders.map(h => escapeCsv(row[h] ?? ''))
    const extraValues = hasReasoning
      ? [escapeCsv(result?.output ?? ''), escapeCsv(result?.reasoning ?? '')]
      : [escapeCsv(result?.output ?? '')]
    csvLines.push([...baseValues, ...extraValues].join(','))
  }

  const baseName = originalFileName.replace(/\.csv$/i, '') || 'enriched'
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}_enriched.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function streamNdjson(
  url: string,
  body: object,
  headers: Record<string, string>,
  onEvent: (event: EnrichmentStreamEvent) => void,
): Promise<{ results: EnrichmentResult[]; usage: ApiUsage | null; unitCount: number }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    let data: Record<string, unknown> = {}
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch { /* ignore */ }
    const code = typeof data.error === 'string' ? data.error : ''
    throw new HttpStreamError(res.status, code, data)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResults: EnrichmentResult[] = []
  let finalUsage: ApiUsage | null = null
  let finalUnitCount = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event: EnrichmentStreamEvent = JSON.parse(line)
        onEvent(event)
        if (event.type === 'complete') {
          finalResults = event.results
          finalUsage = event.usage ?? null
          finalUnitCount = event.unit_count ?? 0
        }
      } catch { /* malformed */ }
    }
  }
  return { results: finalResults, usage: finalUsage, unitCount: finalUnitCount }
}

function countUniqueCompanies(rows: CsvRow[], mapping: FieldMapping): number {
  if (!mapping.company) return rows.length
  const seen = new Set<string>()
  let noCompany = 0
  for (const row of rows) {
    const key = (row[mapping.company] ?? '').trim().toLowerCase()
    if (!key) noCompany++
    else seen.add(key)
  }
  return seen.size + noCompany
}

function formatHoursLeft(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1000))
  if (hours <= 1) return 'dans moins d\'une heure'
  return `dans environ ${hours} h`
}

function errorMessageFor(code: string, data?: Record<string, unknown>): string {
  switch (code) {
    case 'missing_anthropic_key':
      return 'Clé Anthropic manquante. Ajoute-la dans Réglages.'
    case 'missing_openai_key':
      return 'Clé OpenAI manquante. Ajoute-la dans Réglages.'
    case 'too_many_rows':
      return 'Fichier trop volumineux (limite : 1000 lignes par batch).'
    case 'missing_instruction':
      return 'Instruction manquante.'
    case 'missing_exa_key':
      return 'Clé Exa manquante. Ajoute-la dans Réglages ou désactive la recherche site entreprise.'
    case 'exa_requires_company_website_mapping':
      return 'La recherche Exa nécessite que la colonne « Site web de l\'entreprise » soit mappée.'
    case 'gate_required':
      return 'Identification requise avant lancement.'
    case 'rate_limited': {
      const retryMs = typeof data?.retry_after_ms === 'number' ? data.retry_after_ms : 0
      return `Tu as déjà lancé un enrichissement aujourd'hui. Reviens ${formatHoursLeft(retryMs)} (limite : 1 par jour).`
    }
    case 'lead_lookup_failed':
      return 'Erreur côté serveur (identification). Réessaie dans un instant.'
    default:
      return code || 'Erreur lors de la génération.'
  }
}

export default function EnricherPage() {
  const { anthropicKey, openaiKey, exaKey, isLoaded } = useApiKeys()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [state, setState] = useState<PageState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [testResults, setTestResults] = useState<EnrichmentResult[]>([])
  const [testUsage, setTestUsage] = useState<ApiUsage | null>(null)
  const [testUnitCount, setTestUnitCount] = useState(0)
  const [finalResults, setFinalResults] = useState<EnrichmentResult[]>([])
  const [finalUsage, setFinalUsage] = useState<ApiUsage | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [error, setError] = useState('')

  const [cachedRows, setCachedRows] = useState<CsvRow[]>([])
  const [cachedHeaders, setCachedHeaders] = useState<string[]>([])
  const [cachedMapping, setCachedMapping] = useState<FieldMapping>({})
  const [cachedConfig, setCachedConfig] = useState<EnrichmentConfig | null>(null)
  const [cachedFileName, setCachedFileName] = useState('')

  const [jobs, setJobs] = useState<StoredJob[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [completedJobId, setCompletedJobId] = useState<string | null>(null)

  const [leadEmail, setLeadEmail] = useState<string | null>(null)
  const [leadModalOpen, setLeadModalOpen] = useState(false)
  const leadEmailRef = useRef<string | null>(null)

  const snapshotRef = useRef<StoredJob | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LEAD_EMAIL_STORAGE_KEY)
      if (stored) {
        setLeadEmail(stored)
        leadEmailRef.current = stored
      }
    } catch { /* ignore */ }
  }, [])

  const refreshJobs = useCallback(async () => {
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
      await refreshJobs()
    })()
    return () => {
      cancelled = true
    }
  }, [refreshJobs])

  const handledIntentRef = useRef<string | null>(null)

  const flushPersist = useCallback(async () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    const snap = snapshotRef.current
    if (!snap) return
    try {
      await saveJob(snap)
    } catch (err) {
      console.warn('[HISTORY] saveJob failed:', err)
    }
  }, [])

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) return
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      const snap = snapshotRef.current
      if (!snap) return
      saveJob(snap).catch(err => console.warn('[HISTORY] saveJob failed:', err))
    }, PERSIST_DEBOUNCE_MS)
  }, [])

  const buildAuthHeaders = useCallback((opts?: { withLead?: boolean }) => {
    const h: Record<string, string> = {}
    if (anthropicKey) h['X-Anthropic-Api-Key'] = anthropicKey
    if (openaiKey) h['X-OpenAI-Api-Key'] = openaiKey
    if (exaKey) h['X-Exa-Api-Key'] = exaKey
    if (opts?.withLead && leadEmailRef.current) h['X-Lead-Email'] = leadEmailRef.current
    return h
  }, [anthropicKey, openaiKey, exaKey])

  const handleFormSubmit = useCallback(
    async ({ rows, mapping, config, fileName, headers }: { rows: CsvRow[]; mapping: FieldMapping; config: EnrichmentConfig; fileName: string; headers: string[] }) => {
      const provider = getModelProvider(config.model)
      if (provider === 'anthropic' && !anthropicKey) {
        setError('Clé Anthropic manquante. Ajoute-la dans Réglages.')
        setState('error')
        return
      }
      if (provider === 'openai' && !openaiKey) {
        setError('Clé OpenAI manquante. Ajoute-la dans Réglages.')
        setState('error')
        return
      }

      setCachedRows(rows)
      setCachedMapping(mapping)
      setCachedConfig(config)
      setCachedFileName(fileName)
      setCachedHeaders(headers.length ? headers : rows.length > 0 ? Object.keys(rows[0] ?? {}) : [])

      setState('testing')
      setStatusMessage('Test en cours...')
      setProgress({ current: 0, total: Math.min(5, rows.length) })
      setTestResults([])
      setTestUsage(null)
      setTestUnitCount(0)

      try {
        const { results, usage, unitCount } = await streamNdjson(
          '/api/enrich/test',
          { rows, mapping, config },
          buildAuthHeaders(),
          event => {
            if (event.type === 'status') setStatusMessage(event.message)
            if (event.type === 'progress') {
              setProgress({ current: event.current, total: event.total })
              setTestResults(prev => [...prev, event.result])
            }
            if (event.type === 'error') {
              setError(event.message)
              setState('error')
            }
          },
        )
        if (results.length > 0) {
          setTestResults(results)
          setTestUsage(usage)
          setTestUnitCount(unitCount)
          setState('preview')
        } else {
          setState('error')
          setError('Aucun résultat retourné')
        }
      } catch (err) {
        if (err instanceof HttpStreamError) {
          setError(errorMessageFor(err.code, err.data))
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          setError(errorMessageFor(msg))
        }
        setState('error')
      }
    },
    [anthropicKey, openaiKey, buildAuthHeaders],
  )

  const handleBackToForm = useCallback(() => {
    setState('idle')
    setTestResults([])
  }, [])

  const runEnrichment = useCallback(
    async (opts: {
      jobId: string
      fullRows: CsvRow[]
      mapping: FieldMapping
      config: EnrichmentConfig
      headers: string[]
      fileName: string
      indexMap: number[]
      existingResults: EnrichmentResult[]
    }) => {
      const { jobId, fullRows, mapping, config, headers, fileName, indexMap, existingResults } = opts
      const rowsToProcess = indexMap.map(i => fullRows[i]!)
      const total = fullRows.length

      const accumulator = new Map<number, EnrichmentResult>()
      for (const r of existingResults) if (r) accumulator.set(r.row_index, r)

      const createdAt =
        snapshotRef.current?.id === jobId ? snapshotRef.current.createdAt : Date.now()

      const buildSnapshot = (status: 'running' | 'complete', usage: ApiUsage | null, unitCount: number): StoredJob => ({
        id: jobId,
        fileName,
        createdAt,
        updatedAt: Date.now(),
        status,
        rows: fullRows,
        headers,
        mapping,
        config,
        results: Array.from(accumulator.values()).sort((a, b) => a.row_index - b.row_index),
        usage,
        unitCount,
      })

      snapshotRef.current = buildSnapshot('running', null, 0)
      setActiveJobId(jobId)
      setState('generating')
      setStatusMessage(`Génération pour ${rowsToProcess.length} ligne${rowsToProcess.length > 1 ? 's' : ''}...`)
      setProgress({ current: accumulator.size, total })
      setFinalResults(Array.from(accumulator.values()).sort((a, b) => a.row_index - b.row_index))
      setStartedAt(Date.now())
      setFinishedAt(null)
      setFinalUsage(null)
      await flushPersist()

      let streamUsage: ApiUsage | null = null
      let streamUnitCount = 0

      try {
        await streamNdjson(
          '/api/enrich/generate',
          { rows: rowsToProcess, mapping, config },
          buildAuthHeaders({ withLead: true }),
          event => {
            if (event.type === 'status') {
              setStatusMessage(event.message)
            }
            if (event.type === 'progress') {
              const subsetIdx = event.result.row_index
              const originalIdx = indexMap[subsetIdx] ?? subsetIdx
              const remapped: EnrichmentResult = { ...event.result, row_index: originalIdx }
              accumulator.set(originalIdx, remapped)
              const merged = Array.from(accumulator.values()).sort((a, b) => a.row_index - b.row_index)
              setFinalResults(merged)
              setProgress({ current: accumulator.size, total })
              snapshotRef.current = buildSnapshot('running', streamUsage, streamUnitCount)
              schedulePersist()
            }
            if (event.type === 'complete') {
              streamUsage = event.usage ?? null
              streamUnitCount = event.unit_count ?? 0
              for (const r of event.results) {
                const subsetIdx = r.row_index
                const originalIdx = indexMap[subsetIdx] ?? subsetIdx
                accumulator.set(originalIdx, { ...r, row_index: originalIdx })
              }
            }
            if (event.type === 'error') {
              setError(event.message)
              setState('error')
            }
          },
        )

        const merged = Array.from(accumulator.values()).sort((a, b) => a.row_index - b.row_index)
        setFinalResults(merged)
        setFinalUsage(streamUsage)
        const allDone = accumulator.size >= total
        snapshotRef.current = buildSnapshot(allDone ? 'complete' : 'running', streamUsage, streamUnitCount)
        await flushPersist()
        setActiveJobId(null)
        setFinishedAt(Date.now())
        await refreshJobs()
        if (allDone) {
          setCompletedJobId(jobId)
          setState('complete')
        } else {
          setError('Le stream s\'est terminé avant d\'avoir traité toutes les lignes. Tu peux reprendre depuis l\'historique.')
          setState('error')
        }
      } catch (err) {
        snapshotRef.current = buildSnapshot('running', streamUsage, streamUnitCount)
        await flushPersist()
        setActiveJobId(null)
        setFinishedAt(Date.now())
        await refreshJobs()
        if (err instanceof HttpStreamError) {
          setError(errorMessageFor(err.code, err.data))
          if (err.code === 'gate_required') {
            try { window.localStorage.removeItem(LEAD_EMAIL_STORAGE_KEY) } catch { /* ignore */ }
            leadEmailRef.current = null
            setLeadEmail(null)
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          setError(errorMessageFor(msg))
        }
        setState('error')
      }
    },
    [buildAuthHeaders, flushPersist, refreshJobs, schedulePersist],
  )

  const pendingActionRef = useRef<(() => Promise<void>) | null>(null)

  const performLaunch = useCallback(async () => {
    if (!cachedConfig) return
    setFinalResults([])
    const jobId = newJobId()
    await runEnrichment({
      jobId,
      fullRows: cachedRows,
      mapping: cachedMapping,
      config: cachedConfig,
      headers: cachedHeaders,
      fileName: cachedFileName,
      indexMap: cachedRows.map((_, i) => i),
      existingResults: [],
    })
  }, [cachedConfig, cachedRows, cachedMapping, cachedHeaders, cachedFileName, runEnrichment])

  const handleLaunch = useCallback(async () => {
    if (!leadEmail && !IS_DEV) {
      pendingActionRef.current = performLaunch
      setLeadModalOpen(true)
      return
    }
    await performLaunch()
  }, [leadEmail, performLaunch])

  const handleLeadCaptured = useCallback(
    async (email: string) => {
      try { window.localStorage.setItem(LEAD_EMAIL_STORAGE_KEY, email) } catch { /* ignore */ }
      leadEmailRef.current = email
      setLeadEmail(email)
      setLeadModalOpen(false)
      const action = pendingActionRef.current
      pendingActionRef.current = null
      if (action) await action()
    },
    [],
  )

  const handleLeadModalClose = useCallback(() => {
    pendingActionRef.current = null
    setLeadModalOpen(false)
  }, [])

  const handleResume = useCallback(
    async (jobId: string, includeErrors: boolean) => {
      try {
        const stored = await getJob(jobId)
        if (!stored) return
        const storedProvider = getModelProvider(stored.config.model)
        if (storedProvider === 'anthropic' && !anthropicKey) {
          setError('Clé Anthropic manquante. Ajoute-la dans Réglages.')
          setState('error')
          return
        }
        if (storedProvider === 'openai' && !openaiKey) {
          setError('Clé OpenAI manquante. Ajoute-la dans Réglages.')
          setState('error')
          return
        }
        if (stored.config.exa_company_search && !exaKey) {
          setError('Clé Exa manquante. Ajoute-la dans Réglages.')
          setState('error')
          return
        }

        setCachedRows(stored.rows)
        setCachedHeaders(stored.headers)
        setCachedMapping(stored.mapping)
        setCachedConfig(stored.config)
        setCachedFileName(stored.fileName)
        snapshotRef.current = stored

        const missing = findMissingIndexes(stored.rows.length, stored.results, includeErrors)
        if (missing.length === 0) {
          setFinalResults(stored.results)
          setCompletedJobId(stored.id)
          setState('complete')
          return
        }

        const resumeAction = () => runEnrichment({
          jobId: stored.id,
          fullRows: stored.rows,
          mapping: stored.mapping,
          config: stored.config,
          headers: stored.headers,
          fileName: stored.fileName,
          indexMap: missing,
          existingResults: stored.results,
        })

        if (!leadEmail && !IS_DEV) {
          pendingActionRef.current = resumeAction
          setLeadModalOpen(true)
          return
        }
        await resumeAction()
      } catch (err) {
        if (err instanceof HttpStreamError) {
          setError(errorMessageFor(err.code, err.data))
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          setError(errorMessageFor(msg))
        }
        setState('error')
      }
    },
    [anthropicKey, openaiKey, exaKey, leadEmail, runEnrichment],
  )

  const handleViewCompleted = useCallback(async (jobId: string) => {
    try {
      const stored = await getJob(jobId)
      if (!stored) return
      setCachedRows(stored.rows)
      setCachedHeaders(stored.headers)
      setCachedMapping(stored.mapping)
      setCachedConfig(stored.config)
      setCachedFileName(stored.fileName)
      setFinalResults(stored.results)
      setFinalUsage(stored.usage)
      snapshotRef.current = stored
      setCompletedJobId(stored.id)
      setState('complete')
    } catch (err) {
      console.warn('[HISTORY] view failed:', err)
    }
  }, [])

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      try {
        await deleteJob(jobId)
        await refreshJobs()
      } catch (err) {
        console.warn('[HISTORY] delete failed:', err)
      }
    },
    [refreshJobs],
  )

  const resetForNewJob = useCallback(() => {
    setState('idle')
    setFinalResults([])
    setTestResults([])
    setTestUsage(null)
    setTestUnitCount(0)
    setFinalUsage(null)
    setCachedRows([])
    setCachedMapping({})
    setCachedConfig(null)
    setCachedFileName('')
    setCachedHeaders([])
    snapshotRef.current = null
    setCompletedJobId(null)
    setStartedAt(null)
    setFinishedAt(null)
    refreshJobs()
  }, [refreshJobs])

  useEffect(() => {
    if (!isLoaded) return
    const resumeId = searchParams.get('resume')
    const viewId = searchParams.get('view')
    const intent = resumeId ? `resume:${resumeId}` : viewId ? `view:${viewId}` : null
    if (!intent || handledIntentRef.current === intent) return
    handledIntentRef.current = intent
    ;(async () => {
      if (resumeId) await handleResume(resumeId, true)
      else if (viewId) await handleViewCompleted(viewId)
      router.replace('/')
    })()
  }, [isLoaded, searchParams, handleResume, handleViewCompleted, router])

  if (!isLoaded) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        Chargement…
      </div>
    )
  }

  const hasAnyKey = Boolean(anthropicKey || openaiKey)

  const initialState: InitialFormState | null =
    cachedRows.length && cachedConfig
      ? { rows: cachedRows, headers: cachedHeaders, fileName: cachedFileName, mapping: cachedMapping, config: cachedConfig }
      : null

  const successN = finalResults.filter(r => !r.error).length
  const errorN = finalResults.filter(r => r.error).length
  const finalCost = finalUsage && cachedConfig ? computeCost(cachedConfig.model, finalUsage) : null
  const elapsed = startedAt && finishedAt ? Math.max(0, Math.round((finishedAt - startedAt) / 1000)) : null
  const elapsedFmt = elapsed !== null
    ? elapsed < 60
      ? `${elapsed} s`
      : `${Math.floor(elapsed / 60)} min ${elapsed % 60} s`
    : null
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="col2">
      <section>
        {!hasAnyKey && (
          <div className="notice warn">
            <span className="marker">Avis</span>
            <span>
              <span className="title">Aucune clé API configurée.</span>{' '}
              <span className="desc">Ajoute ta clé Anthropic ou OpenAI dans Réglages avant de lancer un enrichissement.</span>
            </span>
            <Link className="cta" href="/settings">→ Réglages</Link>
          </div>
        )}

        {/* ===== STATE: idle / preview ===== */}
        {(state === 'idle' || state === 'preview' || state === 'testing') && (
          <>
            <EnricherForm
              onSubmit={handleFormSubmit}
              disabled={!hasAnyKey}
              initialState={initialState}
            />
            {state === 'testing' && (
              <div className="notice info" style={{ marginTop: 18 }}>
                <span className="marker">Test</span>
                <span>
                  <span className="title">{statusMessage || 'Test en cours…'}</span>{' '}
                  <span className="desc">
                    {progress.current} / {progress.total} ligne{progress.total > 1 ? 's' : ''} ({pct}%)
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{pct}%</span>
              </div>
            )}
            {state === 'preview' && cachedConfig && (
              <EnricherPreview
                results={testResults}
                totalRows={cachedRows.length}
                totalUnits={
                  cachedConfig.mode === 'company'
                    ? countUniqueCompanies(cachedRows, cachedMapping)
                    : cachedRows.length
                }
                unitLabel={cachedConfig.mode === 'company' ? 'entreprises' : 'lignes'}
                testUsage={testUsage}
                testUnitCount={testUnitCount}
                model={cachedConfig.model}
                onBackToForm={handleBackToForm}
                onLaunch={handleLaunch}
                isLaunching={false}
              />
            )}
          </>
        )}

        {/* ===== STATE: generating ===== */}
        {state === 'generating' && (
          <div>
            <div className="state-hero">
              <div className="glyph">En cours de tirage · ne ferme pas l&apos;onglet (mais tu peux)</div>
              <h1 className="display">
                Génération<br />
                <span className="accent">en cours.</span>
              </h1>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
              <span className="ping">
                <span className="dot" />
                ligne <b>{progress.current}</b> / {progress.total}
              </span>
              {cachedConfig && (() => {
                const desc = getModel(cachedConfig.model)
                const cls = desc?.provider === 'openai' ? 'marigold' : 'blue'
                return (
                  <span className={`tag ${cls}`}>
                    <span className="dot" />
                    {desc?.label ?? cachedConfig.model}
                  </span>
                )
              })()}
              {cachedConfig?.exa_company_search && (
                <span className="tag marigold"><span className="dot" />Exa</span>
              )}
            </div>

            <div className="pbar" style={{ marginTop: 14 }}>
              <div className="fill" style={{ width: `${pct}%` }} />
            </div>

            <div className="stats">
              <div className="stat">
                <span className="lbl">Faites</span>
                <span className="val">{progress.current}<small>&nbsp;/ {progress.total}</small></span>
              </div>
              <div className="stat">
                <span className="lbl">Réussies</span>
                <span className="val green">{successN}</span>
              </div>
              <div className="stat">
                <span className="lbl">Échecs</span>
                <span className="val red">{errorN}</span>
              </div>
              <div className="stat">
                <span className="lbl">Progression</span>
                <span className="val">{pct}<small>&nbsp;%</small></span>
              </div>
            </div>

            <div className="section">
              <h2><span className="n">§</span>Lignes traitées</h2>
              <span className="meta">en direct · {finalResults.length} traitées</span>
            </div>

            {finalResults.length > 0 && (
              <table className="ptable">
                <thead>
                  <tr>
                    <th style={{ width: '6%' }}>#</th>
                    <th>nom</th>
                    <th>entreprise</th>
                    <th className="added">output</th>
                  </tr>
                </thead>
                <tbody>
                  {finalResults.slice(-8).reverse().map((r, i) => (
                    <tr key={`${r.row_index}-${i}`}>
                      <td className="num">{r.row_index + 1}</td>
                      <td>{r.display_name || '—'}</td>
                      <td>{r.company || '—'}</td>
                      {r.error ? (
                        <td className="err">{r.error}</td>
                      ) : (
                        <td className="gen">{r.output || '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== STATE: complete ===== */}
        {state === 'complete' && cachedConfig && (
          <div>
            <div className="state-hero">
              <div className="glyph">
                Terminé{elapsedFmt && ` · ${elapsedFmt}`} · {finalResults.length} ligne{finalResults.length > 1 ? 's' : ''}
              </div>
              <h1 className="display">
                Génération<br />
                <span className="accent">terminée.</span>
              </h1>
              <p className="sub">
                {finalResults.length} ligne{finalResults.length > 1 ? 's' : ''} traitée{finalResults.length > 1 ? 's' : ''}, {errorN} erreur{errorN > 1 ? 's' : ''}. Le CSV enrichi est prêt — tes colonnes d&apos;origine + <b>output</b>{cachedConfig.include_reasoning && <> + <b>reasoning</b></>}.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 22, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => downloadCsv(cachedRows, finalResults, cachedHeaders, cachedFileName)}
              >
                ↓ Télécharger {cachedFileName.replace(/\.csv$/i, '')}_enriched.csv
              </button>
              {errorN > 0 && completedJobId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleResume(completedJobId, true)}
                >
                  Réessayer les {errorN} erreur{errorN > 1 ? 's' : ''}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={resetForNewJob}>
                Nouveau job
              </button>
            </div>

            <div className="stats">
              <div className="stat">
                <span className="lbl">Réussies</span>
                <span className="val green">{successN}</span>
              </div>
              <div className="stat">
                <span className="lbl">Erreurs</span>
                <span className="val red">{errorN}</span>
              </div>
              <div className="stat">
                <span className="lbl">Coût réel</span>
                <span className="val">{finalCost ? formatEur(finalCost.total_eur) : '—'}</span>
              </div>
              <div className="stat">
                <span className="lbl">Durée</span>
                <span className="val">{elapsedFmt || '—'}</span>
              </div>
            </div>

            <div className="section">
              <h2><span className="n">§</span>Aperçu des résultats</h2>
              <span className="meta">
                {Math.min(10, finalResults.length)} premières lignes — le CSV complet est dans le téléchargement
              </span>
            </div>

            <table className="ptable">
              <thead>
                <tr>
                  <th>nom</th>
                  <th>entreprise</th>
                  <th className="added">output</th>
                  {cachedConfig.include_reasoning && (
                    <th className="added" style={{ width: '32%' }}>reasoning</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {finalResults.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td>{r.display_name || `Ligne ${r.row_index + 1}`}</td>
                    <td>{r.company || '—'}</td>
                    {r.error ? (
                      <td className="err" colSpan={cachedConfig.include_reasoning ? 2 : 1}>{r.error}</td>
                    ) : (
                      <>
                        <td className="gen">{r.output || '—'}</td>
                        {cachedConfig.include_reasoning && (
                          <td className="reasoning">{r.reasoning || '—'}</td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== STATE: error ===== */}
        {state === 'error' && (
          <div>
            <div className="state-hero">
              <div className="glyph">
                Interrompu{cachedRows.length > 0 && ` · ${progress.current}/${cachedRows.length} ligne${cachedRows.length > 1 ? 's' : ''}`}
              </div>
              <h1 className="display red">
                Une erreur<br />
                <span className="accent">est survenue.</span>
              </h1>
              <p className="sub">
                {error || 'Erreur inattendue.'}
                {progress.current > 0 && (
                  <> Tes {progress.current} premières lignes sont sauvegardées — tu peux les télécharger ou reprendre où tu en étais.</>
                )}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
              <Link href="/settings" className="btn btn-primary btn-lg">
                → Vérifier mes clés
              </Link>
              {completedJobId && progress.current > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => handleResume(completedJobId, true)}>
                  ↻ Reprendre
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={resetForNewJob}>
                Nouveau job
              </button>
              {finalResults.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => downloadCsv(cachedRows, finalResults, cachedHeaders, cachedFileName)}
                >
                  ↓ Télécharger les {finalResults.length} lignes
                </button>
              )}
            </div>

            {progress.current > 0 && (
              <div className="stats">
                <div className="stat">
                  <span className="lbl">Faites avant erreur</span>
                  <span className="val">{progress.current}<small>&nbsp;/ {cachedRows.length}</small></span>
                </div>
                <div className="stat">
                  <span className="lbl">Réussies</span>
                  <span className="val green">{successN}</span>
                </div>
                <div className="stat">
                  <span className="lbl">Erreurs ligne</span>
                  <span className="val red">{errorN}</span>
                </div>
                <div className="stat">
                  <span className="lbl">Coût engagé</span>
                  <span className="val">{finalCost ? formatEur(finalCost.total_eur) : '—'}</span>
                </div>
              </div>
            )}

            <div className="notice info" style={{ marginTop: 24 }}>
              <span className="marker">Note</span>
              <span>
                <span className="title">La reprise relance uniquement les lignes non traitées.</span>{' '}
                <span className="desc">Tu ne re-payes pas celles déjà faites.</span>
              </span>
            </div>
          </div>
        )}
      </section>

      <HistorySection
        jobs={jobs}
        activeJobId={activeJobId}
        liveProgress={state === 'generating' ? progress : null}
        onResume={handleResume}
        onView={handleViewCompleted}
        onDelete={handleDeleteJob}
      />

      <LeadCaptureModal
        open={leadModalOpen}
        onClose={handleLeadModalClose}
        onCaptured={handleLeadCaptured}
      />
    </div>
  )
}
