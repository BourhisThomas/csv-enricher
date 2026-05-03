'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import EnricherForm, { type InitialFormState } from '@/components/EnricherForm'
import EnricherPreview from '@/components/EnricherPreview'
import { useApiKeys } from '@/components/ApiKeysProvider'
import type {
  CsvRow,
  EnrichmentConfig,
  EnrichmentResult,
  EnrichmentStreamEvent,
  FieldMapping,
} from '@/lib/enricher/types'

type PageState = 'idle' | 'testing' | 'preview' | 'generating' | 'complete' | 'error'

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
): Promise<{ results: EnrichmentResult[] }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    let reason = ''
    try {
      const data = await res.json()
      reason = data?.error ?? ''
    } catch { /* ignore */ }
    throw new Error(reason || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResults: EnrichmentResult[] = []

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
        }
      } catch { /* malformed */ }
    }
  }
  return { results: finalResults }
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

function errorMessageFor(code: string): string {
  switch (code) {
    case 'missing_anthropic_key':
      return 'Clé Anthropic manquante. Ajoute-la dans Settings.'
    case 'missing_openai_key':
      return 'Clé OpenAI manquante. Ajoute-la dans Settings.'
    case 'too_many_rows':
      return 'Fichier trop volumineux (limite : 500 lignes par batch).'
    case 'missing_instruction':
      return 'Instruction manquante.'
    default:
      return code || 'Erreur lors de la génération.'
  }
}

export default function EnricherPage() {
  const { anthropicKey, openaiKey, isLoaded } = useApiKeys()

  const [state, setState] = useState<PageState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [testResults, setTestResults] = useState<EnrichmentResult[]>([])
  const [finalResults, setFinalResults] = useState<EnrichmentResult[]>([])
  const [error, setError] = useState('')

  const [cachedRows, setCachedRows] = useState<CsvRow[]>([])
  const [cachedHeaders, setCachedHeaders] = useState<string[]>([])
  const [cachedMapping, setCachedMapping] = useState<FieldMapping>({})
  const [cachedConfig, setCachedConfig] = useState<EnrichmentConfig | null>(null)
  const [cachedFileName, setCachedFileName] = useState('')

  const buildAuthHeaders = useCallback(() => {
    const h: Record<string, string> = {}
    if (anthropicKey) h['X-Anthropic-Api-Key'] = anthropicKey
    if (openaiKey) h['X-OpenAI-Api-Key'] = openaiKey
    return h
  }, [anthropicKey, openaiKey])

  const handleFormSubmit = useCallback(
    async ({ rows, mapping, config, fileName, headers }: { rows: CsvRow[]; mapping: FieldMapping; config: EnrichmentConfig; fileName: string; headers: string[] }) => {
      if (config.model === 'claude-sonnet-4-6' && !anthropicKey) {
        setError('Clé Anthropic manquante. Ajoute-la dans Settings.')
        setState('error')
        return
      }
      if (config.model === 'gpt-4.1-mini' && !openaiKey) {
        setError('Clé OpenAI manquante. Ajoute-la dans Settings.')
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

      try {
        const { results } = await streamNdjson(
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
          setState('preview')
        } else {
          setState('error')
          setError('Aucun résultat retourné')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(errorMessageFor(msg))
        setState('error')
      }
    },
    [anthropicKey, openaiKey, buildAuthHeaders],
  )

  const handleBackToForm = useCallback(() => {
    setState('idle')
    setTestResults([])
  }, [])

  const handleLaunch = useCallback(async () => {
    if (!cachedConfig) return
    setState('generating')
    setStatusMessage(`Génération pour ${cachedRows.length} lignes...`)
    setProgress({ current: 0, total: cachedRows.length })
    setFinalResults([])

    try {
      const { results } = await streamNdjson(
        '/api/enrich/generate',
        { rows: cachedRows, mapping: cachedMapping, config: cachedConfig },
        buildAuthHeaders(),
        event => {
          if (event.type === 'status') setStatusMessage(event.message)
          if (event.type === 'progress') {
            setProgress({ current: event.current, total: event.total })
            setFinalResults(prev => [...prev, event.result])
          }
          if (event.type === 'error') {
            setError(event.message)
            setState('error')
          }
        },
      )
      if (results.length > 0) {
        setFinalResults(results)
        setState('complete')
      } else if (state !== 'error') {
        setState('error')
        setError('Aucun résultat retourné')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(errorMessageFor(msg))
      setState('error')
    }
  }, [cachedConfig, cachedRows, cachedMapping, state, buildAuthHeaders])

  if (!isLoaded) {
    return <div className="p-8 text-sm text-gray-500">Chargement...</div>
  }

  const hasAnyKey = Boolean(anthropicKey || openaiKey)

  if (state === 'testing' || state === 'generating') {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="text-sm font-medium text-gray-700">{statusMessage}</div>
        {progress.total > 0 && (
          <>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-black transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-gray-500">{progress.current} / {progress.total}</div>
          </>
        )}
      </div>
    )
  }

  if (state === 'preview' && cachedConfig) {
    const totalUnits = cachedConfig.mode === 'company'
      ? countUniqueCompanies(cachedRows, cachedMapping)
      : cachedRows.length
    return (
      <div className="py-8">
        <EnricherPreview
          results={testResults}
          totalRows={cachedRows.length}
          totalUnits={totalUnits}
          unitLabel={cachedConfig.mode === 'company' ? 'entreprises' : 'lignes'}
          onBackToForm={handleBackToForm}
          onLaunch={handleLaunch}
          isLaunching={false}
        />
      </div>
    )
  }

  if (state === 'complete' && cachedConfig) {
    const successCount = finalResults.filter(r => !r.error).length
    const errorCount = finalResults.filter(r => r.error).length
    return (
      <div className="max-w-md mx-auto py-12 text-center space-y-6">
        <h2 className="text-2xl font-bold">Génération terminée</h2>
        <div className="flex justify-center gap-6 text-sm">
          <div><span className="text-2xl font-bold">{successCount}</span> générés</div>
          {errorCount > 0 && <div className="text-red-600"><span className="text-2xl font-bold">{errorCount}</span> erreurs</div>}
        </div>
        <button
          onClick={() => downloadCsv(cachedRows, finalResults, cachedHeaders, cachedFileName)}
          className="w-full py-3 bg-black text-white rounded-md font-medium hover:bg-gray-800"
        >
          Télécharger le CSV enrichi
        </button>
        <button
          onClick={() => {
            setState('idle')
            setFinalResults([])
            setTestResults([])
            setCachedRows([])
            setCachedMapping({})
            setCachedConfig(null)
            setCachedFileName('')
            setCachedHeaders([])
          }}
          className="w-full py-2 text-sm text-gray-600 hover:text-black underline"
        >
          Nouveau fichier
        </button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="max-w-md mx-auto py-12 space-y-4">
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="font-medium text-red-800 mb-1">Erreur</div>
          <div className="text-sm text-red-700">{error || 'Erreur inattendue.'}</div>
        </div>
        <button
          onClick={() => { setState('idle'); setError('') }}
          className="w-full py-2 bg-black text-white rounded-md font-medium hover:bg-gray-800"
        >
          Réessayer
        </button>
      </div>
    )
  }

  const initialState: InitialFormState | null =
    cachedRows.length && cachedConfig
      ? { rows: cachedRows, headers: cachedHeaders, fileName: cachedFileName, mapping: cachedMapping, config: cachedConfig }
      : null

  return (
    <div className="py-8">
      {!hasAnyKey && (
        <div className="max-w-3xl mx-auto mb-6 border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm">
          <strong>Aucune clé API configurée.</strong> Va dans{' '}
          <Link href="/settings" className="underline font-medium">Settings</Link>{' '}
          pour ajouter ta clé Anthropic ou OpenAI avant de lancer un enrichissement.
        </div>
      )}
      <EnricherForm onSubmit={handleFormSubmit} disabled={!hasAnyKey} initialState={initialState} />
    </div>
  )
}
