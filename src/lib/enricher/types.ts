export type EnricherModel = 'gpt-4.1-mini' | 'claude-sonnet-4-6'

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
  web_search: boolean
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
  sonnet_in: number
  sonnet_out: number
  gpt_mini_in: number
  gpt_mini_out: number
  web_search_calls: number
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
