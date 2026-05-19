export interface ExaSearchResult {
  url: string
  title: string
  text: string
  publishedDate?: string
}

export class ExaFatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExaFatalError'
  }
}

interface ExaApiResponse {
  results: Array<{
    url: string
    title?: string
    text?: string
    publishedDate?: string
  }>
}

export function extractDomain(websiteUrl: string): string | null {
  if (!websiteUrl) return null
  const trimmed = websiteUrl.trim()
  if (!trimmed) return null
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withProtocol)
    return u.hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}

export async function searchExa(params: {
  apiKey: string
  query: string
  domain?: string | null
  numResults?: number
  textChars?: number
}): Promise<ExaSearchResult[]> {
  const { apiKey, query, domain, numResults = 5, textChars = 1500 } = params
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      ...(domain ? { includeDomains: [domain] } : {}),
      numResults,
      contents: { text: { maxCharacters: textChars } },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 402 || body.includes('NO_MORE_CREDITS')) {
      throw new ExaFatalError(
        'Crédits Exa épuisés. Top up sur https://dashboard.exa.ai/billing puis régénère ta clé.',
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new ExaFatalError('Clé Exa invalide ou non autorisée. Vérifie-la dans Settings.')
    }
    throw new Error(`Exa API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as ExaApiResponse
  return (data.results ?? []).map(r => ({
    url: r.url,
    title: r.title ?? '',
    text: (r.text ?? '').trim(),
    publishedDate: r.publishedDate,
  }))
}

export function formatExaResultsForLLM(results: ExaSearchResult[]): string {
  if (!results.length) return 'Aucun résultat trouvé sur ce site pour cette query.'
  return results
    .map((r, i) => {
      const header = `[${i + 1}] ${r.title || r.url}\nURL: ${r.url}${r.publishedDate ? `\nDate: ${r.publishedDate}` : ''}`
      const body = r.text ? `\n${r.text}` : ''
      return `${header}${body}`
    })
    .join('\n\n---\n\n')
}
