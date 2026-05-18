import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildUserPrompt, buildSystemPrompt, needsJson } from './prompt'
import { searchCompanyWebsite, extractDomain, formatExaResultsForLLM, ExaFatalError } from './exa'
import {
  emptyUsage,
  getModelProvider,
  isValidModelId,
  type ApiUsage,
  type CsvRow,
  type EnrichmentConfig,
  type EnrichmentResult,
  type FieldMapping,
  type OutputFormat,
} from './types'

const CONCURRENCY = 3
const MAX_TOOL_ITERATIONS = 5
const EXA_NUM_RESULTS = 5
const EXA_TEXT_CHARS = 1500
const EXA_TOOL_NAME = 'search_company_website'
const EXA_TOOL_DESCRIPTION =
  "Recherche dans les pages du site web officiel de l'entreprise (restreint à son domaine). À utiliser pour trouver des infos publiques sur l'entreprise (services, équipe, pricing, case studies). Queries courtes et ciblées."

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
  exaKey?: string
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

interface RunContext {
  systemPrompt: string
  userPrompt: string
  config: EnrichmentConfig
  exaToolActive: boolean
  companyDomain: string | null
  exaKey: string | null
  maxTokens: number
  usage: ApiUsage
}

async function runAnthropic(anthropic: Anthropic, ctx: RunContext): Promise<string> {
  const tools: Anthropic.Messages.ToolUnion[] = []
  if (ctx.config.native_web_search) {
    tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 })
  }
  if (ctx.exaToolActive) {
    tools.push({
      name: EXA_TOOL_NAME,
      description: EXA_TOOL_DESCRIPTION,
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Requête de recherche, en quelques mots.' },
        },
        required: ['query'],
      },
    })
  }

  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: ctx.userPrompt }]

  const callOnce = async (forceExa: boolean): Promise<Anthropic.Messages.Message> => {
    const response = await anthropic.messages.create({
      model: ctx.config.model,
      max_tokens: ctx.maxTokens,
      system: ctx.systemPrompt,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(forceExa
        ? { tool_choice: { type: 'tool' as const, name: EXA_TOOL_NAME } }
        : {}),
    })
    ctx.usage.anthropic_in += response.usage.input_tokens
    ctx.usage.anthropic_out += response.usage.output_tokens
    if (ctx.config.native_web_search) {
      ctx.usage.native_web_search_calls += response.content.filter(
        b => b.type === 'server_tool_use',
      ).length
    }
    return response
  }

  let response = await callOnce(ctx.exaToolActive)
  let iter = 0
  while (response.stop_reason === 'tool_use' && iter++ < MAX_TOOL_ITERATIONS) {
    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    )
    if (!toolUses.length) break

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      if (tu.name === EXA_TOOL_NAME && ctx.exaToolActive && ctx.exaKey && ctx.companyDomain) {
        const input = tu.input as { query?: string }
        const query = (input.query ?? '').trim()
        try {
          const results = await searchCompanyWebsite({
            apiKey: ctx.exaKey,
            query,
            domain: ctx.companyDomain,
            numResults: EXA_NUM_RESULTS,
            textChars: EXA_TEXT_CHARS,
          })
          ctx.usage.exa_calls += 1
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: formatExaResultsForLLM(results),
          })
        } catch (err) {
          if (err instanceof ExaFatalError) {
            console.error('[ENRICHMENT] exa fatal:', err.message)
            throw err
          }
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[ENRICHMENT] exa transient error:', msg)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Erreur Exa: ${msg}`,
            is_error: true,
          })
        }
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Tool non disponible pour cette ligne.',
          is_error: true,
        })
      }
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
    response = await callOnce(false)
  }

  return response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
}

type OpenAIResponse = OpenAI.Responses.Response
type OpenAIInputItem = OpenAI.Responses.ResponseInputItem
type OpenAITool = OpenAI.Responses.Tool

function buildOutputSchema(config: EnrichmentConfig): Record<string, unknown> {
  const outputType =
    config.output_format === 'boolean'
      ? 'boolean'
      : config.output_format === 'number'
        ? 'number'
        : 'string'

  const properties: Record<string, unknown> = { output: { type: outputType } }
  const required = ['output']

  if (config.include_reasoning) {
    properties.reasoning = { type: 'string' }
    required.push('reasoning')
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

async function runOpenAI(openai: OpenAI, ctx: RunContext): Promise<string> {
  const tools: OpenAITool[] = []
  if (ctx.config.native_web_search) {
    tools.push({ type: 'web_search_preview' })
  }
  if (ctx.exaToolActive) {
    tools.push({
      type: 'function',
      name: EXA_TOOL_NAME,
      description: EXA_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Requête de recherche, en quelques mots.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      strict: true,
    })
  }

  const accumulate = (response: OpenAIResponse) => {
    ctx.usage.openai_in += response.usage?.input_tokens ?? 0
    ctx.usage.openai_out += response.usage?.output_tokens ?? 0
    if (ctx.config.native_web_search && Array.isArray(response.output)) {
      ctx.usage.native_web_search_calls += response.output.filter(o => o.type === 'web_search_call').length
    }
  }

  const useJson = needsJson(ctx.config)
  const textFormat = useJson
    ? {
        text: {
          format: {
            type: 'json_schema' as const,
            name: 'enrichment_output',
            schema: buildOutputSchema(ctx.config),
            strict: true,
          },
        },
      }
    : {}

  let response = (await openai.responses.create({
    model: ctx.config.model,
    instructions: ctx.systemPrompt,
    input: ctx.userPrompt,
    max_output_tokens: ctx.maxTokens,
    ...(tools.length ? { tools } : {}),
    ...textFormat,
    ...(ctx.exaToolActive
      ? { tool_choice: { type: 'function' as const, name: EXA_TOOL_NAME } }
      : {}),
  })) as OpenAIResponse
  accumulate(response)

  let iter = 0
  while (iter++ < MAX_TOOL_ITERATIONS) {
    if (!Array.isArray(response.output)) break
    const fnCalls = response.output.filter(
      (o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call',
    )
    if (!fnCalls.length) break

    const fnOutputs: OpenAIInputItem[] = []
    for (const fc of fnCalls) {
      if (fc.name === EXA_TOOL_NAME && ctx.exaToolActive && ctx.exaKey && ctx.companyDomain) {
        try {
          const args = JSON.parse(fc.arguments) as { query?: string }
          const results = await searchCompanyWebsite({
            apiKey: ctx.exaKey,
            query: (args.query ?? '').trim(),
            domain: ctx.companyDomain,
            numResults: EXA_NUM_RESULTS,
            textChars: EXA_TEXT_CHARS,
          })
          ctx.usage.exa_calls += 1
          fnOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: formatExaResultsForLLM(results),
          })
        } catch (err) {
          if (err instanceof ExaFatalError) {
            console.error('[ENRICHMENT] exa fatal:', err.message)
            throw err
          }
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[ENRICHMENT] exa transient error:', msg)
          fnOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: `Erreur: ${msg}`,
          })
        }
      } else {
        fnOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: 'Tool non disponible pour cette ligne.',
        })
      }
    }

    response = (await openai.responses.create({
      model: ctx.config.model,
      previous_response_id: response.id,
      input: fnOutputs,
      max_output_tokens: ctx.maxTokens,
      ...(tools.length ? { tools } : {}),
      ...textFormat,
    })) as OpenAIResponse
    accumulate(response)
  }

  return (response.output_text ?? '').trim()
}

async function generateOne(
  row: CsvRow,
  mapping: FieldMapping,
  config: EnrichmentConfig,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
  exaKey: string | null,
  usage: ApiUsage,
): Promise<EnrichmentResult> {
  const display_name = getDisplayName(row, mapping)
  const company = getCompany(row, mapping)
  const websiteRaw = mapping.company_website ? (row[mapping.company_website] ?? '').trim() : ''
  const companyDomain = config.exa_company_search && exaKey ? extractDomain(websiteRaw) : null
  const exaToolActive = !!companyDomain

  if (config.exa_company_search) {
    if (!exaKey) {
      console.warn(`[ENRICHMENT] exa active but no key — row "${display_name}"`)
    } else if (!mapping.company_website) {
      console.warn(`[ENRICHMENT] exa active but mapping.company_website not set — row "${display_name}"`)
    } else if (!websiteRaw) {
      console.warn(`[ENRICHMENT] exa active but website cell empty — row "${display_name}"`)
    } else if (!companyDomain) {
      console.warn(`[ENRICHMENT] exa active but domain extraction failed for "${websiteRaw}" — row "${display_name}"`)
    }
  }

  const systemPrompt = buildSystemPrompt(config, {
    native_web_search: config.native_web_search,
    exa_company_search: exaToolActive,
  })
  const userPrompt = buildUserPrompt({ row, mapping, config })
  const isJson = needsJson(config)
  const hasAnyTool = config.native_web_search || exaToolActive
  const maxTokens = hasAnyTool ? 2000 : isJson ? 400 : 300

  const ctx: RunContext = {
    systemPrompt,
    userPrompt,
    config,
    exaToolActive,
    companyDomain,
    exaKey,
    maxTokens,
    usage,
  }

  try {
    const provider = getModelProvider(config.model)
    let rawText: string
    if (provider === 'openai') {
      if (!openai) throw new Error('Clé OpenAI manquante — ajoute-la dans Settings')
      rawText = await runOpenAI(openai, ctx)
    } else if (provider === 'anthropic') {
      if (!anthropic) throw new Error('Clé Anthropic manquante — ajoute-la dans Settings')
      rawText = await runAnthropic(anthropic, ctx)
    } else {
      throw new Error(`Modèle inconnu : ${config.model}`)
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
  exaKey: string | null,
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
    const result = await generateOne(representativeRow, mapping, config, anthropic, openai, exaKey, usage)
    for (const idx of indexes) {
      results[idx] = { ...result, row_index: idx }
      await onProgress(results[idx], Math.min(total, results.filter(Boolean).length), total)
    }
  }

  async function processNoCompanyRow(idx: number) {
    const row = rows[idx]!
    const result = await generateOne(row, mapping, config, anthropic, openai, exaKey, usage)
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
  const usage: ApiUsage = emptyUsage()

  const { rows, config, anthropicKey, openaiKey, exaKey } = options
  const startedAt = Date.now()

  if (!isValidModelId(config.model)) {
    throw new Error(`Modèle inconnu : ${config.model}`)
  }
  const provider = getModelProvider(config.model)
  if (provider === 'anthropic' && !anthropicKey) {
    throw new Error('Clé Anthropic manquante — ajoute-la dans Settings')
  }
  if (provider === 'openai' && !openaiKey) {
    throw new Error('Clé OpenAI manquante — ajoute-la dans Settings')
  }
  if (config.exa_company_search && !exaKey) {
    throw new Error('Clé Exa manquante — ajoute-la dans Settings')
  }

  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null
  const exa = exaKey ?? null

  console.log(
    `[ENRICHMENT] start mode=${config.mode} rows=${rows.length} exa=${config.exa_company_search} native_search=${config.native_web_search} model=${config.model}`,
  )

  let output: GeneratorOutput
  if (config.mode === 'company') {
    output = await runCompanyMode(options, anthropic, openai, exa, usage)
  } else {
    const { mapping, onProgress } = options
    const total = rows.length
    const results: EnrichmentResult[] = new Array(total)

    let current = 0
    async function processRow(index: number) {
      const row = rows[index]
      if (!row) return
      const result = await generateOne(row, mapping, config, anthropic, openai, exa, usage)
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
      `tokens={anthropic_in:${usage.anthropic_in},anthropic_out:${usage.anthropic_out},openai_in:${usage.openai_in},openai_out:${usage.openai_out}} ` +
      `native_search=${usage.native_web_search_calls} exa=${usage.exa_calls}`,
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
