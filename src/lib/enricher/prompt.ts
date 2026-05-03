import type {
  CsvRow,
  EnrichmentConfig,
  FieldMapping,
  OutputFormat,
} from './types'

interface PromptContext {
  row: CsvRow
  mapping: FieldMapping
  config: EnrichmentConfig
}

function get(row: CsvRow, mapping: FieldMapping, key: keyof FieldMapping): string {
  const col = mapping[key]
  if (!col) return ''
  return (row[col] ?? '').trim()
}

const FORMAT_INSTRUCTIONS: Record<OutputFormat, string> = {
  text: 'Texte libre (1-3 phrases courtes, factuel).',
  number: 'Un nombre entier ou décimal, sans unité ni texte autour. Ex: 42 ou 3.5',
  boolean: 'Strictement "true" ou "false" (minuscules, anglais).',
}

export function buildUserPrompt(ctx: PromptContext): string {
  const { row, mapping, config } = ctx
  const lines: string[] = []

  if (config.mode === 'prospect') {
    const prenom = get(row, mapping, 'prenom')
    const nom = get(row, mapping, 'nom')
    const jobTitle = get(row, mapping, 'job_title')
    const jobDescription = get(row, mapping, 'job_description')
    const linkedinUrl = get(row, mapping, 'linkedin_url')
    const fullName = [prenom, nom].filter(Boolean).join(' ')
    const prospectFacts: string[] = []
    if (fullName) prospectFacts.push(`**Nom :** ${fullName}`)
    if (jobTitle) prospectFacts.push(`**Poste :** ${jobTitle}`)
    if (jobDescription) prospectFacts.push(`**Description du poste :** ${jobDescription}`)
    if (linkedinUrl) prospectFacts.push(`**LinkedIn :** ${linkedinUrl}`)
    if (prospectFacts.length) {
      lines.push('## Contexte prospect')
      lines.push(...prospectFacts)
      lines.push('')
    }
  }

  const company = get(row, mapping, 'company')
  const companyWebsite = get(row, mapping, 'company_website')
  const companyLinkedinUrl = get(row, mapping, 'company_linkedin_url')
  const companyDescription = get(row, mapping, 'company_description')
  const companyFacts: string[] = []
  if (company) companyFacts.push(`**Entreprise :** ${company}`)
  if (companyWebsite) companyFacts.push(`**Site web :** ${companyWebsite}`)
  if (companyLinkedinUrl) companyFacts.push(`**LinkedIn entreprise :** ${companyLinkedinUrl}`)
  if (companyDescription) companyFacts.push(`**Description entreprise :** ${companyDescription}`)
  if (companyFacts.length) {
    lines.push('## Contexte entreprise')
    lines.push(...companyFacts)
    lines.push('')
  }

  if (config.custom_fields.length > 0) {
    const customLines: string[] = []
    for (const field of config.custom_fields) {
      const value = (row[field.column] ?? '').trim()
      if (value && field.label) customLines.push(`**${field.label} :** ${value}`)
    }
    if (customLines.length) {
      lines.push('## Champs supplémentaires')
      lines.push(...customLines)
      lines.push('')
    }
  }

  lines.push('## Instruction')
  lines.push(config.instruction)
  lines.push('')

  if (config.additional_notes) {
    lines.push('## Notes supplémentaires')
    lines.push(config.additional_notes)
    lines.push('')
  }

  return lines.join('\n').trim()
}

export function needsJson(config: EnrichmentConfig): boolean {
  if (config.include_reasoning) return true
  return config.output_format !== 'text'
}

export function buildSystemPrompt(config: EnrichmentConfig): string {
  const subject =
    config.mode === 'company'
      ? 'une entreprise'
      : 'un prospect B2B (personne et son entreprise)'

  const searchClause = config.web_search
    ? '\n- Tu as accès à un outil web_search : utilise-le pour vérifier des éléments concrets sur le web (site de l\'entreprise, news récentes, profils publics) avant de conclure. Cite tes sources (URL, date) dans le reasoning quand demandé.'
    : ''

  const base = `Tu es un expert en recherche B2B. Ta mission est d'analyser rigoureusement les informations disponibles sur ${subject} et de répondre à l'instruction donnée.

Règles absolues :
- Rigueur factuelle : ne conclus positivement QUE si un élément concret le confirme. En l'absence d'évidence, réponds par la valeur négative DU FORMAT demandé : false pour un booléen, 0 pour un nombre, "" (chaîne vide) pour un texte. NE renvoie JAMAIS la valeur null ni la chaîne "null".
- Pas de flatterie ni de ton commercial — uniquement de l'analyse factuelle.
- En français sauf instruction contraire.${searchClause}`

  const useJson = needsJson(config)
  const fmt = FORMAT_INSTRUCTIONS[config.output_format]

  if (!useJson) {
    return `${base}\n\nFormat de sortie : ${fmt}\nRéponds UNIQUEMENT avec la valeur, sans introduction, sans guillemets englobants, sans explication.`
  }

  const shape = config.include_reasoning
    ? `{"output": <valeur>, "reasoning": "<une phrase courte avec la source>"}`
    : `{"output": <valeur>}`
  return `${base}\n\nFormat de sortie : ${fmt}\nRéponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte autour.\nStructure exacte : ${shape}`
}
