import { runEnrichmentBatch } from '@/lib/enricher/generator'
import {
  getModelProvider,
  isValidModelId,
  type EnrichmentStreamEvent,
  type CsvRow,
  type FieldMapping,
  type EnrichmentConfig,
} from '@/lib/enricher/types'
import {
  checkRateLimit,
  findLeadByEmail,
  recordEnrichment,
  type LeadRecord,
} from '@/lib/notion/leads'
import { validateProEmail } from '@/lib/email/validate'

export const maxDuration = 300

const MAX_ROWS = 1000
const IS_DEV = process.env.NODE_ENV === 'development'

function validateConfig(
  config: EnrichmentConfig | undefined,
  mapping: FieldMapping | undefined,
): string | null {
  if (!config) return 'missing_config'
  if (config.mode !== 'prospect' && config.mode !== 'company') return 'invalid_mode'
  if (!config.instruction || !config.instruction.trim()) return 'missing_instruction'
  if (!isValidModelId(config.model)) return 'invalid_model'
  if (config.exa_company_search && !mapping?.company_website) return 'exa_requires_company_website_mapping'
  return null
}

export async function POST(req: Request) {
  const anthropicKey = req.headers.get('x-anthropic-api-key') || undefined
  const openaiKey = req.headers.get('x-openai-api-key') || undefined
  const exaKey = req.headers.get('x-exa-api-key') || undefined
  const leadEmailHeader = req.headers.get('x-lead-email') || ''

  let lead: LeadRecord | null = null
  if (!IS_DEV) {
    const emailCheck = validateProEmail(leadEmailHeader)
    if (!emailCheck.ok) {
      return Response.json({ error: 'gate_required' }, { status: 401 })
    }

    try {
      lead = await findLeadByEmail(emailCheck.email!, { retries: true })
    } catch (err) {
      console.error('[GENERATE] lead lookup failed:', err)
      return Response.json({ error: 'lead_lookup_failed' }, { status: 502 })
    }
    if (!lead) {
      return Response.json({ error: 'gate_required' }, { status: 401 })
    }

    const decision = checkRateLimit(lead)
    if (!decision.allowed) {
      return Response.json(
        {
          error: 'rate_limited',
          retry_after_ms: decision.retryAfterMs,
          next_available_at: decision.nextAvailableAt?.toISOString(),
        },
        { status: 429 },
      )
    }
  } else {
    console.log('[GENERATE] dev mode: skipping lead gate')
  }

  let body: { rows: CsvRow[]; mapping: FieldMapping; config: EnrichmentConfig }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { rows, mapping, config } = body
  if (!rows?.length) return Response.json({ error: 'missing_rows' }, { status: 400 })

  const configError = validateConfig(config, mapping)
  if (configError) return Response.json({ error: configError }, { status: 400 })

  const provider = getModelProvider(config.model)
  if (provider === 'anthropic' && !anthropicKey) {
    return Response.json({ error: 'missing_anthropic_key' }, { status: 400 })
  }
  if (provider === 'openai' && !openaiKey) {
    return Response.json({ error: 'missing_openai_key' }, { status: 400 })
  }
  if ((config.exa_company_search || config.exa_web_search) && !exaKey) {
    return Response.json({ error: 'missing_exa_key' }, { status: 400 })
  }

  if (rows.length > MAX_ROWS) {
    return Response.json(
      { error: 'too_many_rows', limit: MAX_ROWS, received: rows.length },
      { status: 400 },
    )
  }

  if (lead) {
    recordEnrichment(lead.pageId, lead.nbEnrichments).catch(err =>
      console.error('[GENERATE] recordEnrichment failed:', err),
    )
  }

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const send = (event: EnrichmentStreamEvent) =>
    writer.write(encoder.encode(JSON.stringify(event) + '\n'))

  ;(async () => {
    try {
      await send({ type: 'status', message: `Génération pour ${rows.length} lignes...` })

      const { results, usage, unit_count } = await runEnrichmentBatch({
        rows,
        mapping,
        config,
        anthropicKey,
        openaiKey,
        exaKey,
        onProgress: async (result, current, total) => {
          await send({ type: 'progress', current, total, result })
        },
      })

      await send({ type: 'complete', results, usage, unit_count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la génération'
      console.error('[ENRICHMENT/GENERATE] error:', err)
      await send({ type: 'error', message })
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
