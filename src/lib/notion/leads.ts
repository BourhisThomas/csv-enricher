import 'server-only'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

export type LeadPurpose = 'Mon entreprise' | 'Un client' | 'Curiosité' | 'Autre'
export type LeadUsage =
  | 'Vérifier listes prospection'
  | 'Remplacer Claygent'
  | 'Enrichir CRM'
  | 'Autre'

export interface LeadInput {
  email: string
  purpose: LeadPurpose
  usage: LeadUsage
  userAgent?: string
  ip?: string
}

export interface LeadRecord {
  pageId: string
  email: string
  lastEnrichedAt: Date | null
  nbEnrichments: number
  superUser: boolean
}

function notionEnv(): { token: string; databaseId: string } {
  const token = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_LEADS_DATABASE_ID
  if (!token || !databaseId) {
    throw new Error('notion_not_configured')
  }
  return { token, databaseId }
}

async function notionFetch(path: string, init?: RequestInit): Promise<Response> {
  const { token } = notionEnv()
  return fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).toLowerCase()
}

function readDate(prop: unknown): Date | null {
  if (!prop || typeof prop !== 'object') return null
  const date = (prop as { date?: { start?: string } | null }).date
  if (!date?.start) return null
  const d = new Date(date.start)
  return isNaN(d.getTime()) ? null : d
}

function readNumber(prop: unknown): number {
  if (!prop || typeof prop !== 'object') return 0
  const n = (prop as { number?: number | null }).number
  return typeof n === 'number' ? n : 0
}

function readTitlePlain(prop: unknown): string {
  if (!prop || typeof prop !== 'object') return ''
  const arr = (prop as { title?: Array<{ plain_text?: string }> }).title
  if (!Array.isArray(arr)) return ''
  return arr.map(t => t.plain_text ?? '').join('').trim()
}

function readCheckbox(prop: unknown): boolean {
  if (!prop || typeof prop !== 'object') return false
  const v = (prop as { checkbox?: boolean }).checkbox
  return v === true
}

interface NotionPage {
  id: string
  properties: Record<string, unknown>
}

function mapPage(page: NotionPage): LeadRecord {
  return {
    pageId: page.id,
    email: readTitlePlain(page.properties['Email']).toLowerCase(),
    lastEnrichedAt: readDate(page.properties['Dernier enrichissement']),
    nbEnrichments: readNumber(page.properties['Nb enrichissements']),
    superUser: readCheckbox(page.properties['Super user']),
  }
}

export async function findLeadByEmail(email: string): Promise<LeadRecord | null> {
  const { databaseId } = notionEnv()
  const normalized = email.trim().toLowerCase()
  const res = await notionFetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        property: 'Email',
        title: { equals: normalized },
      },
      page_size: 1,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`notion_query_failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { results: NotionPage[] }
  if (!data.results?.length) return null
  return mapPage(data.results[0]!)
}

export async function createLead(input: LeadInput): Promise<LeadRecord> {
  const { databaseId } = notionEnv()
  const email = input.email.trim().toLowerCase()
  const now = new Date().toISOString()

  const properties: Record<string, unknown> = {
    Email: { title: [{ text: { content: email } }] },
    Domaine: { rich_text: [{ text: { content: domainOf(email) } }] },
    'Pour qui': { select: { name: input.purpose } },
    Usage: { select: { name: input.usage } },
    'Première visite': { date: { start: now } },
    'Nb enrichissements': { number: 0 },
  }
  if (input.userAgent) {
    properties['User Agent'] = { rich_text: [{ text: { content: input.userAgent.slice(0, 1900) } }] }
  }
  if (input.ip) {
    properties['IP'] = { rich_text: [{ text: { content: input.ip } }] }
  }

  const res = await notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`notion_create_failed: ${res.status} ${text}`)
  }
  const page = (await res.json()) as NotionPage
  return mapPage(page)
}

export async function upsertLead(input: LeadInput): Promise<LeadRecord> {
  const existing = await findLeadByEmail(input.email)
  if (existing) return existing
  return createLead(input)
}

export async function recordEnrichment(pageId: string, currentCount: number): Promise<void> {
  const res = await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'Dernier enrichissement': { date: { start: new Date().toISOString() } },
        'Nb enrichissements': { number: currentCount + 1 },
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`notion_update_failed: ${res.status} ${text}`)
  }
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs?: number
  nextAvailableAt?: Date
  superUser?: boolean
}

export function checkRateLimit(lead: LeadRecord, now: Date = new Date()): RateLimitDecision {
  if (lead.superUser) return { allowed: true, superUser: true }
  if (!lead.lastEnrichedAt) return { allowed: true }
  const elapsed = now.getTime() - lead.lastEnrichedAt.getTime()
  if (elapsed >= RATE_LIMIT_WINDOW_MS) return { allowed: true }
  const retryAfterMs = RATE_LIMIT_WINDOW_MS - elapsed
  return {
    allowed: false,
    retryAfterMs,
    nextAvailableAt: new Date(now.getTime() + retryAfterMs),
  }
}
