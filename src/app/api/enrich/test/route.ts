import { runEnrichmentBatch, sampleForTest } from '@/lib/enricher/generator'
import type {
  EnrichmentStreamEvent,
  CsvRow,
  FieldMapping,
  EnrichmentConfig,
} from '@/lib/enricher/types'

export const maxDuration = 120

const TEST_SAMPLE_SIZE = 5

function validateConfig(config: EnrichmentConfig | undefined): string | null {
  if (!config) return 'missing_config'
  if (config.mode !== 'prospect' && config.mode !== 'company') return 'invalid_mode'
  if (!config.instruction || !config.instruction.trim()) return 'missing_instruction'
  if (config.model !== 'claude-sonnet-4-6' && config.model !== 'gpt-4.1-mini') return 'invalid_model'
  return null
}

export async function POST(req: Request) {
  const anthropicKey = req.headers.get('x-anthropic-api-key') || undefined
  const openaiKey = req.headers.get('x-openai-api-key') || undefined

  let body: { rows: CsvRow[]; mapping: FieldMapping; config: EnrichmentConfig }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { rows, mapping, config } = body
  if (!rows?.length) return Response.json({ error: 'missing_rows' }, { status: 400 })

  const configError = validateConfig(config)
  if (configError) return Response.json({ error: configError }, { status: 400 })

  if (config.model === 'claude-sonnet-4-6' && !anthropicKey) {
    return Response.json({ error: 'missing_anthropic_key' }, { status: 400 })
  }
  if (config.model === 'gpt-4.1-mini' && !openaiKey) {
    return Response.json({ error: 'missing_openai_key' }, { status: 400 })
  }

  const testRows = sampleForTest(rows, mapping, config.mode, TEST_SAMPLE_SIZE)

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const send = (event: EnrichmentStreamEvent) =>
    writer.write(encoder.encode(JSON.stringify(event) + '\n'))

  ;(async () => {
    try {
      await send({
        type: 'status',
        message: `Test sur ${testRows.length} ${config.mode === 'company' ? 'entreprises' : 'lignes'}...`,
      })

      const { results, usage, unit_count } = await runEnrichmentBatch({
        rows: testRows,
        mapping,
        config,
        anthropicKey,
        openaiKey,
        onProgress: async (result, current, total) => {
          await send({ type: 'progress', current, total, result })
        },
      })

      await send({ type: 'complete', results, usage, unit_count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du test'
      console.error('[ENRICHMENT/TEST] error:', err)
      await send({ type: 'error', message })
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
