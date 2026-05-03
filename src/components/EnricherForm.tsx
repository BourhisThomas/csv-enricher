'use client'

import { useRef, useState } from 'react'
import {
  FIELD_LABELS,
  PROSPECT_FIELDS,
  COMPANY_FIELDS,
} from '@/lib/enricher/types'
import type {
  CsvRow,
  CustomInputField,
  EnricherModel,
  EnrichmentConfig,
  EnrichmentMode,
  FieldKey,
  FieldMapping,
  OutputFormat,
} from '@/lib/enricher/types'

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  if (!text) return { headers: [], rows: [] }

  let firstLineEnd = text.length
  {
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') { i++; continue }
        inQuotes = !inQuotes
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        firstLineEnd = i
        break
      }
    }
  }
  const firstLine = text.slice(0, firstLineEnd)
  const separator = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  const parsed: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  const pushField = () => { currentRow.push(currentField.trim()); currentField = '' }
  const pushRow = () => {
    if (!(currentRow.length === 1 && currentRow[0] === '')) parsed.push(currentRow)
    currentRow = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { currentField += '"'; i++ }
        else { inQuotes = false }
      } else {
        currentField += ch
      }
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === separator) { pushField(); continue }
    if (ch === '\r') continue
    if (ch === '\n') { pushField(); pushRow(); continue }
    currentField += ch
  }
  if (currentField !== '' || currentRow.length > 0) { pushField(); pushRow() }

  if (parsed.length < 2) return { headers: [], rows: [] }
  const headers = parsed[0]!
  const rows = parsed.slice(1).map(values => {
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
  return { headers, rows }
}

function autoDetect(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {}
  const lower = headers.map(h => h.toLowerCase())
  const matchers: [FieldKey, string[]][] = [
    ['prenom', ['prénom', 'prenom', 'first_name', 'firstname', 'first name', 'given name']],
    ['nom', ['nom', 'last_name', 'lastname', 'last name', 'family name', 'surname']],
    ['job_title', ['job title', 'job_title', 'titre', 'poste', 'title', 'fonction', 'intitulé']],
    ['job_description', ['job description', 'job_description', 'description poste', 'description du poste']],
    ['linkedin_url', ['linkedin', 'linkedin url', 'linkedin_url', 'profil linkedin', 'person linkedin', 'contact linkedin']],
    ['company', ['company', 'entreprise', 'société', 'organization', 'organisation', 'account name']],
    ['company_website', ['website', 'site web', 'company website', 'company_website', 'site', 'url', 'domaine', 'domain']],
    ['company_linkedin_url', ['company linkedin', 'linkedin entreprise', 'company_linkedin', 'company linkedin url']],
    ['company_description', ['company description', 'description entreprise', 'company_description', 'about company']],
  ]
  for (const [key, keywords] of matchers) {
    for (const kw of keywords) {
      const idx = lower.findIndex(h => h.includes(kw))
      if (idx !== -1 && headers[idx] && !Object.values(mapping).includes(headers[idx])) {
        mapping[key] = headers[idx]
        break
      }
    }
  }
  return mapping
}

export interface InitialFormState {
  rows: CsvRow[]
  headers: string[]
  fileName: string
  mapping: FieldMapping
  config: EnrichmentConfig
}

interface Props {
  onSubmit: (data: { rows: CsvRow[]; mapping: FieldMapping; config: EnrichmentConfig; fileName: string; headers: string[] }) => void
  disabled: boolean
  initialState?: InitialFormState | null
}

export default function EnricherForm({ onSubmit, disabled, initialState }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [headers, setHeaders] = useState<string[]>(initialState?.headers ?? [])
  const [rows, setRows] = useState<CsvRow[]>(initialState?.rows ?? [])
  const [fileName, setFileName] = useState(initialState?.fileName ?? '')
  const [mapping, setMapping] = useState<FieldMapping>(initialState?.mapping ?? {})

  const [mode, setMode] = useState<EnrichmentMode>(initialState?.config.mode ?? 'prospect')
  const [instruction, setInstruction] = useState(initialState?.config.instruction ?? '')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialState?.config.output_format ?? 'text')
  const [customFields, setCustomFields] = useState<CustomInputField[]>(initialState?.config.custom_fields ?? [])
  const [webSearch, setWebSearch] = useState(initialState?.config.web_search ?? true)
  const [model, setModel] = useState<EnricherModel>(initialState?.config.model ?? 'claude-sonnet-4-6')
  const [includeReasoning, setIncludeReasoning] = useState(initialState?.config.include_reasoning ?? false)
  const [additionalNotes, setAdditionalNotes] = useState(initialState?.config.additional_notes ?? '')

  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState('')

  function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setParseError('Le fichier doit être au format .csv')
      return
    }
    setParseError('')
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.headers.length) {
        setParseError('Impossible de lire le fichier CSV — vérifie le format')
        return
      }
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setFileName(file.name)
      setMapping(autoDetect(parsed.headers))
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function updateFieldMapping(key: FieldKey, column: string) {
    setMapping(prev => {
      const next = { ...prev }
      if (column) next[key] = column
      else delete next[key]
      return next
    })
  }

  function addCustomField() {
    setCustomFields(prev => [...prev, { id: randomId(), label: '', column: '' }])
  }
  function updateCustomField(id: string, patch: Partial<CustomInputField>) {
    setCustomFields(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  function removeCustomField(id: string) {
    setCustomFields(prev => prev.filter(f => f.id !== id))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rows.length || !instruction.trim()) return

    const cleanedCustomFields = customFields
      .filter(f => f.label.trim() && f.column)
      .map(f => ({ ...f, label: f.label.trim() }))

    const config: EnrichmentConfig = {
      mode,
      instruction: instruction.trim(),
      output_format: outputFormat,
      web_search: webSearch,
      model,
      include_reasoning: includeReasoning,
      custom_fields: cleanedCustomFields,
      additional_notes: additionalNotes.trim() || undefined,
    }

    onSubmit({ rows, mapping, config, fileName, headers })
  }

  const visibleBuiltInFields: FieldKey[] = mode === 'company' ? COMPANY_FIELDS : [...PROSPECT_FIELDS, ...COMPANY_FIELDS]
  const canSubmit = rows.length > 0 && !disabled && instruction.trim().length > 0

  const sectionCls = 'border-t border-gray-200 pt-6 first:border-t-0 first:pt-0'
  const sectionTitleCls = 'text-sm font-semibold uppercase tracking-wide text-gray-700 mb-3'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black'
  const selectCls = inputCls
  const radioCardCls = (active: boolean) =>
    `flex-1 flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${active ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`

  return (
    <form className="space-y-8 max-w-3xl mx-auto" onSubmit={handleSubmit}>

      <div className={sectionCls}>
        <div className={sectionTitleCls}>1. Importer le CSV</div>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${dragOver ? 'border-black bg-gray-50' : fileName ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
          {fileName ? (
            <div className="text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="text-gray-500"> · {rows.length} lignes</span>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Glisse un fichier CSV ou <span className="underline">parcourir</span>
            </div>
          )}
        </div>
        {parseError && <div className="mt-2 text-sm text-red-600">{parseError}</div>}
      </div>

      {headers.length > 0 && (
        <>
          <div className={sectionCls}>
            <div className={sectionTitleCls}>2. Type d&apos;enrichissement</div>
            <div className="flex gap-3">
              <label className={radioCardCls(mode === 'prospect')}>
                <input type="radio" name="mode" value="prospect" checked={mode === 'prospect'} onChange={() => setMode('prospect')} className="mt-1" />
                <div>
                  <div className="font-medium text-sm">Prospect</div>
                  <div className="text-xs text-gray-600">Recherche par personne (1 ligne = 1 enrichissement)</div>
                </div>
              </label>
              <label className={radioCardCls(mode === 'company')}>
                <input type="radio" name="mode" value="company" checked={mode === 'company'} onChange={() => setMode('company')} className="mt-1" />
                <div>
                  <div className="font-medium text-sm">Entreprise</div>
                  <div className="text-xs text-gray-600">Déduplication par entreprise (1 appel par société unique)</div>
                </div>
              </label>
            </div>

            <div className="mt-6">
              <div className={sectionTitleCls}>Mapper les champs</div>
              <p className="text-xs text-gray-500 mb-3">Associe chaque champ à une colonne du CSV. Les champs non mappés sont ignorés.</p>
              <div className="space-y-2">
                {visibleBuiltInFields.map(key => (
                  <div key={key} className="grid grid-cols-[180px_1fr] items-center gap-3">
                    <label className="text-sm text-gray-700">{FIELD_LABELS[key]}</label>
                    <select
                      className={selectCls}
                      value={mapping[key] ?? ''}
                      onChange={e => updateFieldMapping(key, e.target.value)}
                    >
                      <option value="">— non mappé —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className={sectionTitleCls}>Champs personnalisés</div>
              <p className="text-xs text-gray-500 mb-3">Colonnes additionnelles à passer en contexte au LLM (ex: secteur, taille).</p>
              <div className="space-y-2">
                {customFields.map(field => (
                  <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input type="text" className={inputCls} placeholder="Libellé (ex: Secteur)" value={field.label} onChange={e => updateCustomField(field.id, { label: e.target.value })} />
                    <select className={selectCls} value={field.column} onChange={e => updateCustomField(field.id, { column: e.target.value })}>
                      <option value="">— colonne CSV —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <button type="button" onClick={() => removeCustomField(field.id)} className="px-2 text-gray-400 hover:text-red-600" aria-label="Supprimer">×</button>
                  </div>
                ))}
                <button type="button" onClick={addCustomField} className="text-sm text-gray-600 hover:text-black underline">+ Ajouter un champ personnalisé</button>
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <div className={sectionTitleCls}>3. Instruction</div>
            <textarea
              className={inputCls}
              placeholder="Ex: Détermine si l'entreprise a récemment annoncé une levée de fonds, un déménagement ou un événement interne. Réponds true/false."
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              rows={4}
            />
            <div className="mt-3">
              <label className={labelCls}>Format attendu</label>
              <select className={selectCls} value={outputFormat} onChange={e => setOutputFormat(e.target.value as OutputFormat)}>
                <option value="text">Texte libre</option>
                <option value="number">Nombre</option>
                <option value="boolean">Booléen (true / false)</option>
              </select>
            </div>
          </div>

          <div className={sectionCls}>
            <div className={sectionTitleCls}>4. Options</div>
            <div className="space-y-3">
              <label className={labelCls}>Modèle</label>
              <div className="flex gap-3">
                <label className={radioCardCls(model === 'claude-sonnet-4-6')}>
                  <input type="radio" name="model" value="claude-sonnet-4-6" checked={model === 'claude-sonnet-4-6'} onChange={() => setModel('claude-sonnet-4-6')} className="mt-1" />
                  <div>
                    <div className="font-medium text-sm">Claude Sonnet 4.6</div>
                    <div className="text-xs text-gray-600">Anthropic · plus précis</div>
                  </div>
                </label>
                <label className={radioCardCls(model === 'gpt-4.1-mini')}>
                  <input type="radio" name="model" value="gpt-4.1-mini" checked={model === 'gpt-4.1-mini'} onChange={() => setModel('gpt-4.1-mini')} className="mt-1" />
                  <div>
                    <div className="font-medium text-sm">GPT-4.1 mini</div>
                    <div className="text-xs text-gray-600">OpenAI · plus rapide</div>
                  </div>
                </label>
              </div>

              <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
                <input type="checkbox" checked={webSearch} onChange={e => setWebSearch(e.target.checked)} />
                <span>Activer la recherche web (web_search natif {model === 'claude-sonnet-4-6' ? 'Anthropic' : 'OpenAI'})</span>
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={includeReasoning} onChange={e => setIncludeReasoning(e.target.checked)} />
                <span>Ajouter une colonne &quot;Reasoning&quot; (1 phrase factuelle citant la source)</span>
              </label>

              <div className="mt-3">
                <label className={labelCls}>Notes supplémentaires (optionnel)</label>
                <textarea
                  className={inputCls}
                  placeholder="Ex: Ignore les résultats antérieurs à 2024."
                  value={additionalNotes}
                  onChange={e => setAdditionalNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 bg-black text-white rounded-md font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            Tester sur {Math.min(5, rows.length)} {mode === 'company' ? 'entreprises' : 'lignes'}
          </button>
        </>
      )}
    </form>
  )
}
