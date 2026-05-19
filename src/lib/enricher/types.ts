export type ModelProvider = 'anthropic' | 'openai'

export interface ModelDescriptor {
  id: string
  label: string
  short: string
  provider: ModelProvider
  tier: '$' | '$$' | '$$$' | '$$$$'
  hint: string
  pricing_usd_per_m: { input: number; output: number }
}

export const MODEL_REGISTRY: ModelDescriptor[] = [
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    short: 'Opus 4.7',
    provider: 'anthropic',
    tier: '$$$$',
    hint: 'qualité maximale · cher',
    pricing_usd_per_m: { input: 15, output: 75 },
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    short: 'Sonnet 4.6',
    provider: 'anthropic',
    tier: '$$$',
    hint: 'équilibre qualité / prix · défaut',
    pricing_usd_per_m: { input: 3, output: 15 },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    short: 'Haiku 4.5',
    provider: 'anthropic',
    tier: '$$',
    hint: 'rapide et abordable',
    pricing_usd_per_m: { input: 1, output: 5 },
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    short: 'GPT-5',
    provider: 'openai',
    tier: '$$$',
    hint: 'haut de gamme OpenAI',
    pricing_usd_per_m: { input: 1.25, output: 10 },
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    short: 'GPT-5 mini',
    provider: 'openai',
    tier: '$$',
    hint: 'récent · économique',
    pricing_usd_per_m: { input: 0.25, output: 2 },
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    short: 'GPT-4.1',
    provider: 'openai',
    tier: '$$',
    hint: 'génération précédente · solide',
    pricing_usd_per_m: { input: 2, output: 8 },
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    short: 'GPT-4.1 mini',
    provider: 'openai',
    tier: '$',
    hint: 'le moins cher',
    pricing_usd_per_m: { input: 0.4, output: 1.6 },
  },
]

export type EnricherModel = (typeof MODEL_REGISTRY)[number]['id']

export const DEFAULT_MODEL: EnricherModel = 'claude-sonnet-4-6'

export function getModel(id: string): ModelDescriptor | undefined {
  return MODEL_REGISTRY.find(m => m.id === id)
}

export function isValidModelId(id: string): boolean {
  return MODEL_REGISTRY.some(m => m.id === id)
}

export function getModelProvider(id: string): ModelProvider | null {
  return getModel(id)?.provider ?? null
}

export type EnrichmentMode = 'prospect' | 'company'
export type OutputFormat = 'text' | 'number' | 'boolean'

export type FieldKey =
  | 'nom'
  | 'prenom'
  | 'job_title'
  | 'job_description'
  | 'linkedin_url'
  | 'company'
  | 'company_website'
  | 'company_linkedin_url'
  | 'company_description'

export const PROSPECT_FIELDS: FieldKey[] = [
  'prenom',
  'nom',
  'job_title',
  'job_description',
  'linkedin_url',
]

export const COMPANY_FIELDS: FieldKey[] = [
  'company',
  'company_website',
  'company_linkedin_url',
  'company_description',
]

export const FIELD_LABELS: Record<FieldKey, string> = {
  nom: 'Nom',
  prenom: 'Prénom',
  job_title: 'Job title',
  job_description: 'Description du poste',
  linkedin_url: 'LinkedIn URL (personne)',
  company: 'Entreprise',
  company_website: 'Site web de l\'entreprise',
  company_linkedin_url: 'LinkedIn URL (entreprise)',
  company_description: 'Description de l\'entreprise',
}

export type FieldMapping = Partial<Record<FieldKey, string>>

export interface CustomInputField {
  id: string
  label: string
  column: string
}

export interface EnrichmentConfig {
  mode: EnrichmentMode
  instruction: string
  output_format: OutputFormat
  exa_company_search: boolean
  exa_web_search: boolean
  native_web_search: boolean
  model: EnricherModel
  include_reasoning: boolean
  custom_fields: CustomInputField[]
  additional_notes?: string
}

export type CsvRow = Record<string, string>

export interface EnrichmentResult {
  row_index: number
  display_name: string
  company: string
  output?: string
  reasoning?: string
  error?: string
}

export interface ApiUsage {
  anthropic_in: number
  anthropic_out: number
  openai_in: number
  openai_out: number
  native_web_search_calls: number
  exa_calls: number
}

export function emptyUsage(): ApiUsage {
  return {
    anthropic_in: 0,
    anthropic_out: 0,
    openai_in: 0,
    openai_out: 0,
    native_web_search_calls: 0,
    exa_calls: 0,
  }
}

export type EnrichmentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'progress'; current: number; total: number; result: EnrichmentResult }
  | {
      type: 'complete'
      results: EnrichmentResult[]
      usage?: ApiUsage
      unit_count?: number
    }
  | { type: 'error'; message: string }
