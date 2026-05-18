import { upsertLead, type LeadPurpose, type LeadUsage } from '@/lib/notion/leads'
import { validateProEmail } from '@/lib/email/validate'

export const runtime = 'nodejs'

const VALID_PURPOSES: LeadPurpose[] = ['Mon entreprise', 'Un client', 'Curiosité', 'Autre']
const VALID_USAGES: LeadUsage[] = [
  'Vérifier listes prospection',
  'Remplacer Claygent',
  'Enrichir CRM',
  'Autre',
]

function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  return real ?? undefined
}

export async function POST(req: Request) {
  let body: { email?: unknown; purpose?: unknown; usage?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const emailCheck = validateProEmail(body.email)
  if (!emailCheck.ok) {
    return Response.json({ error: emailCheck.error }, { status: 400 })
  }

  if (typeof body.purpose !== 'string' || !VALID_PURPOSES.includes(body.purpose as LeadPurpose)) {
    return Response.json({ error: 'invalid_purpose' }, { status: 400 })
  }
  if (typeof body.usage !== 'string' || !VALID_USAGES.includes(body.usage as LeadUsage)) {
    return Response.json({ error: 'invalid_usage' }, { status: 400 })
  }

  try {
    const lead = await upsertLead({
      email: emailCheck.email!,
      purpose: body.purpose as LeadPurpose,
      usage: body.usage as LeadUsage,
      userAgent: req.headers.get('user-agent') ?? undefined,
      ip: clientIp(req),
    })
    return Response.json({ ok: true, email: lead.email })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    console.error('[LEADS] upsert failed:', msg)
    if (msg === 'notion_not_configured') {
      return Response.json({ error: 'notion_not_configured' }, { status: 500 })
    }
    return Response.json({ error: 'notion_error' }, { status: 502 })
  }
}
