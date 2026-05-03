import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildUserPrompt, buildSystemPrompt, needsJson } from './prompt'
import type {
  ApiUsage,
  CsvRow,
  EnrichmentConfig,
  EnrichmentResult,
  FieldMapping,
  OutputFormat,
} from './types'

const CONCURRENCY = 3

function normalizeValue(v: unknown, format: OutputFormat): string {
  if (v === null || v === undefined) return negativeFor(format)
  if (typeof v === 'string') {
    const lower = v.trim().toLowerCase()
    if (lower === 'null' || lower === 'undefined' || lower === 'none') return negativeFor(format)
    return v
  }
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  return String(v)
}

function negativeFor(format: OutputFormat): string {
  if (format === 'boolean') return 'false'
  if (format === 'number') return '0'
  return ''
}

interface GeneratorOptions {
  rows: CsvRow[]
  mapping: FieldMapping
  config: EnrichmentConfig
  anthropicKey?: string
  openaiKey?: string
  onProgress: (result: EnrichmentResult, current: number, total: number) => Promise<void>
}

export interface GeneratorOutput {
  results: EnrichmentResult[]
  usage: ApiUsage
  unit_count: number
}

function getDisplayName(row: CsvRow, mapping: FieldMapping): string {
  const prenom = mapping.prenom ? (row[mapping.prenom] ?? '').trim() : ''
  const nom = mapping.nom ? (row[mapping.nom] ?? '').trim() : ''
  return [prenom, nom].filter(Boolean).join(' ') || `Ligne ${Object.values(row)[0] ?? '?'}`
}

function getCompany(row: CsvRow, mapping: FieldMapping): string {
  return mapping.company ? (row[mapping.company] ?? '').trim() : ''
}

function companyKey(row: CsvRow, mapping: FieldMapping): string {
  return getCompany(row, mapping).toLowerCase()
}

async function generateOne(
  row: CsvRow,
  mapping: FieldMapping,
  config: EnrichmentConfig,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
  usage: ApiUsage,
): Promise<EnrichmentResult> {
  const display_name = getDisplayName(row, mapping)
  const company = getCompany(row, mapping)
  const systemPrompt = buildSystemPrompt(config)
  const userPrompt = buildUserPrompt({ row, mapping, config })
  const isJson = needsJson(config)
  const maxTokens = config.web_search ? 1500 : (isJson ? 400 : 300)

  try {
    let rawText: string

    if (config.model === 'gpt-4.1-mini') {
      if (!openai) throw new Error('Clé OpenAI manquante — ajoute-la dans Settings')
      const response = await openai.responses.create({
        model: 'gpt-4.1-mini',
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: maxTokens,
        ...(config.web_search ? { tools: [{ type: 'web_search_preview' }] } : {}),
      })
      rawText = response.output_text?.trim() ?? ''
      usage.gpt_mini_in += response.usage?.input_tokens ?? 0
      usage.gpt_mini_out += response.usage?.output_tokens ?? 0
      if (config.web_search && Array.isArray(response.output)) {
        usage.web_search_calls += response.output.filter(o => o.type === 'web_search_call').length
      }
    } else {
      if (!anthropic) throw new Error('Clé Anthropic manquante — ajoute-la dans Settings')
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        ...(config.web_search
          ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] }
          : {}),
      })
      rawText = message.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
        .trim()
      usage.sonnet_in += message.usage.input_tokens
      usage.sonnet_out += message.usage.output_tokens
      if (config.web_search) {
        usage.web_search_calls += message.content.filter(b => b.type === 'server_tool_use').length
      }
    }

    if (!isJson) {
      return { row_index: 0, display_name, company, output: rawText }
    }

    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    try {
      const parsed = JSON.parse(jsonText) as { output?: unknown; reasoning?: string }
      const reasoning = parsed.reasoning ? String(parsed.reasoning) : undefined
      const output = normalizeValue(parsed.output, config.output_format)
      return { row_index: 0, display_name, company, output, reasoning }
    } catch {
      console.error('[ENRICHMENT] JSON parse failed, using raw text:', rawText.slice(0, 120))
      return { row_index: 0, display_name, company, output: rawText }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[ENRICHMENT] generation error:', error)
    return { row_index: 0, display_name, company, output: '', error }
  }
}

async function runCompanyMode(
  options: GeneratorOptions,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
  usage: ApiUsage,
): Promise<GeneratorOutput> {
  const { rows, mapping, config, onProgress } = options
  const total = rows.length
  const results: EnrichmentResult[] = new Array(total)

  const groups = new Map<string, number[]>()
  const noCompanyIndexes: number[] = []
  rows.forEach((row, i) => {
    const key = companyKey(row, mapping)
    if (!key) {
      noCompanyIndexes.push(i)
      return
    }
    const existing = groups.get(key)
    if (existing) existing.push(i)
    else groups.set(key, [i])
  })

  const groupKeys = [...groups.keys()]
  const totalUnits = groupKeys.length + noCompanyIndexes.length

  async function processGroup(key: string) {
    const indexes = groups.get(key)!
    const representativeIdx = indexes[0]!
    const representativeRow = rows[representativeIdx]!
    const result = await generateOne(representativeRow, mapping, config, anthropic, openai, usage)
    for (const idx of indexes) {
      results[idx] = { ...result, row_index: idx }
      await onProgress(results[idx], Math.min(total, results.filter(Boolean).length), total)
    }
  }

  async function processNoCompanyRow(idx: number) {
    const row = rows[idx]!
    const result = await generateOne(row, mapping, config, anthropic, openai, usage)
    result.row_index = idx
    results[idx] = result
    await onProgress(result, Math.min(total, results.filter(Boolean).length), total)
  }

  for (let i = 0; i < groupKeys.length; i += CONCURRENCY) {
    const batch = groupKeys.slice(i, i + CONCURRENCY).map(processGroup)
    await Promise.all(batch)
  }
  for (let i = 0; i < noCompanyIndexes.length; i += CONCURRENCY) {
    const batch = noCompanyIndexes.slice(i, i + CONCURRENCY).map(processNoCompanyRow)
    await Promise.all(batch)
  }

  return { results, usage, unit_count: totalUnits }
}

export async function runEnrichmentBatch(options: GeneratorOptions): Promise<GeneratorOutput> {
  const usage: ApiUsage = {
    sonnet_in: 0,
    sonnet_out: 0,
    gpt_mini_in: 0,
    gpt_mini_out: 0,
    web_search_calls: 0,
  }

  const { rows, config, anthropicKey, openaiKey } = options
  const startedAt = Date.now()

  if (config.model === 'claude-sonnet-4-6' && !anthropicKey) {
    throw new Error('Clé Anthropic manquante — ajoute-la dans Settings')
  }
  if (config.model === 'gpt-4.1-mini' && !openaiKey) {
    throw new Error('Clé OpenAI manquante — ajoute-la dans Settings')
  }

  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null

  console.log(
    `[ENRICHMENT] start mode=${config.mode} rows=${rows.length} web_search=${config.web_search} model=${config.model}`,
  )

  let output: GeneratorOutput
  if (config.mode === 'company') {
    output = await runCompanyMode(options, anthropic, openai, usage)
  } else {
    const { mapping, onProgress } = options
    const total = rows.length
    const results: EnrichmentResult[] = new Array(total)

    let current = 0
    async function processRow(index: number) {
      const row = rows[index]
      if (!row) return
      const result = await generateOne(row, mapping, config, anthropic, openai, usage)
      result.row_index = index
      results[index] = result
      current++
      await onProgress(result, current, total)
    }

    for (let i = 0; i < total; i += CONCURRENCY) {
      const batch = []
      for (let j = i; j < Math.min(i + CONCURRENCY, total); j++) {
        batch.push(processRow(j))
      }
      await Promise.all(batch)
    }
    output = { results, usage, unit_count: total }
  }

  const errors = output.results.filter(r => r?.error).length
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `[ENRICHMENT] done rows=${rows.length} units=${output.unit_count} errors=${errors} elapsed=${elapsedSec}s ` +
      `tokens={sonnet_in:${usage.sonnet_in},sonnet_out:${usage.sonnet_out},gpt_mini_in:${usage.gpt_mini_in},gpt_mini_out:${usage.gpt_mini_out}} ` +
      `web_search_calls=${usage.web_search_calls}`,
  )

  return output
}

export function sampleForTest(
  rows: CsvRow[],
  mapping: FieldMapping,
  mode: EnrichmentConfig['mode'],
  sampleSize: number,
): CsvRow[] {
  if (mode !== 'company') return rows.slice(0, sampleSize)
  const seenKeys = new Set<string>()
  const picked: CsvRow[] = []
  for (const row of rows) {
    if (picked.length >= sampleSize) break
    const key = companyKey(row, mapping)
    if (!key) {
      picked.push(row)
      continue
    }
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      picked.push(row)
    }
  }
  return picked
}
