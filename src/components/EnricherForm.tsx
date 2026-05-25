'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useApiKeys } from '@/components/ApiKeysProvider'
import {
  DEFAULT_MODEL,
  FIELD_LABELS,
  MODEL_REGISTRY,
  PROSPECT_FIELDS,
  COMPANY_FIELDS,
  getModel,
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

function parseCSV(text: string): { headers: string[]; rows: CsvRow[]; separator: string } {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  if (!text) return { headers: [], rows: [], separator: ',' }

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

  if (parsed.length < 2) return { headers: [], rows: [], separator }
  const headers = parsed[0]!
  const rows = parsed.slice(1).map(values => {
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
  return { headers, rows, separator }
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

const REQUIRED_PROSPECT_FIELDS: FieldKey[] = ['prenom', 'nom']
const REQUIRED_COMPANY_FIELDS: FieldKey[] = ['company']

export default function EnricherForm({ onSubmit, disabled, initialState }: Props) {
  const { anthropicKey, openaiKey, exaKey } = useApiKeys()
  const fileRef = useRef<HTMLInputElement>(null)
  const [headers, setHeaders] = useState<string[]>(initialState?.headers ?? [])
  const [rows, setRows] = useState<CsvRow[]>(initialState?.rows ?? [])
  const [fileName, setFileName] = useState(initialState?.fileName ?? '')
  const [separator, setSeparator] = useState<string>(',')
  const [mapping, setMapping] = useState<FieldMapping>(initialState?.mapping ?? {})

  const [mode, setMode] = useState<EnrichmentMode>(initialState?.config.mode ?? 'prospect')
  const [instruction, setInstruction] = useState(initialState?.config.instruction ?? '')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialState?.config.output_format ?? 'text')
  const [customFields, setCustomFields] = useState<CustomInputField[]>(initialState?.config.custom_fields ?? [])
  const [exaCompanySearch, setExaCompanySearch] = useState(initialState?.config.exa_company_search ?? false)
  const [exaWebSearch, setExaWebSearch] = useState(initialState?.config.exa_web_search ?? false)
  const [nativeWebSearch, setNativeWebSearch] = useState(initialState?.config.native_web_search ?? false)
  const [model, setModel] = useState<EnricherModel>(initialState?.config.model ?? DEFAULT_MODEL)
  const [includeReasoning, setIncludeReasoning] = useState(initialState?.config.include_reasoning ?? true)
  const [additionalNotes, setAdditionalNotes] = useState(initialState?.config.additional_notes ?? '')

  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState('')

  const availableModels = useMemo(
    () =>
      MODEL_REGISTRY.filter(m =>
        m.provider === 'anthropic' ? !!anthropicKey : !!openaiKey,
      ),
    [anthropicKey, openaiKey],
  )

  const currentModelDescriptor = getModel(model)
  const currentModelHasKey =
    currentModelDescriptor?.provider === 'anthropic' ? !!anthropicKey : !!openaiKey
  if (currentModelDescriptor && !currentModelHasKey && availableModels[0] && availableModels[0].id !== model) {
    setModel(availableModels[0].id)
  }

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
      setSeparator(parsed.separator)
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

  function clearFile() {
    setHeaders([])
    setRows([])
    setFileName('')
    setMapping({})
    if (fileRef.current) fileRef.current.value = ''
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
      exa_company_search: exaCompanySearch,
      exa_web_search: exaWebSearch,
      native_web_search: nativeWebSearch,
      model,
      include_reasoning: includeReasoning,
      custom_fields: cleanedCustomFields,
      additional_notes: additionalNotes.trim() || undefined,
    }

    onSubmit({ rows, mapping, config, fileName, headers })
  }

  const visibleBuiltInFields: FieldKey[] = mode === 'company' ? COMPANY_FIELDS : [...PROSPECT_FIELDS, ...COMPANY_FIELDS]
  const requiredFields = mode === 'company' ? REQUIRED_COMPANY_FIELDS : REQUIRED_PROSPECT_FIELDS
  const mappedCount = visibleBuiltInFields.filter(k => mapping[k]).length
  const canSubmit = rows.length > 0 && !disabled && instruction.trim().length > 0

  return (
    <form onSubmit={handleSubmit}>
      {/* I · Source */}
      <div className="section">
        <h2><span className="n">I.</span>Source</h2>
        <span className="meta">CSV · 2 000 lignes max</span>
      </div>

      {fileName ? (
        <div className="file-card">
          <div className="glyph">CSV</div>
          <div>
            <div className="name">{fileName}</div>
            <div className="desc">
              {rows.length} lignes · séparateur «&nbsp;{separator}&nbsp;» · UTF-8
            </div>
          </div>
          <div className="row-gap">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fileRef.current?.click()}
            >
              Changer
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFile}>
              Retirer
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`drop ${dragOver ? 'dragover' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        >
          <div className="glyph">CSV</div>
          <div>
            <div className="ti">Dépose ton CSV</div>
            <div className="desc">
              jusqu&apos;à 2 000 lignes · <b>données 100% locales</b>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
            Parcourir
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileInput} />
      {parseError && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--cherry)' }}>{parseError}</div>
      )}

      {headers.length > 0 && (
        <>
          {/* II · Cible */}
          <div className="section">
            <h2><span className="n">II.</span>Sur quoi porte la recherche ?</h2>
            <span className="meta">détermine les colonnes à mapper</span>
          </div>

          <div className="mode-picker">
            <button
              type="button"
              className={`mode-card ${mode === 'prospect' ? 'active' : ''}`}
              onClick={() => setMode('prospect')}
              aria-pressed={mode === 'prospect'}
            >
              <span className="mode-title">Par prospect <span className="mode-sub">— une ligne, une recherche</span></span>
              <span className="mode-desc">
                chaque ligne est traitée individuellement. Idéal quand l&apos;info dépend de la personne (poste, ancienneté, profil LinkedIn).
              </span>
            </button>
            <button
              type="button"
              className={`mode-card ${mode === 'company' ? 'active' : ''}`}
              onClick={() => setMode('company')}
              aria-pressed={mode === 'company'}
            >
              <span className="mode-title">Par entreprise <span className="mode-badge">dédup</span></span>
              <span className="mode-desc">
                regroupe les lignes par entreprise et ne fait qu&apos;une recherche par société (moins cher si plusieurs contacts par boîte).
              </span>
            </button>
          </div>

          {/* III · Mapping */}
          <div className="section">
            <h2><span className="n">III.</span>Mapping des colonnes</h2>
            <span className="meta">
              {headers.length} colonne{headers.length > 1 ? 's' : ''} détectée{headers.length > 1 ? 's' : ''} · {mappedCount} mappée{mappedCount > 1 ? 's' : ''}
            </span>
          </div>

          <div className="mapping">
            {visibleBuiltInFields.map(key => {
              const column = mapping[key] ?? ''
              const isRequired = requiredFields.includes(key)
              const exaRequired = key === 'company_website' && exaCompanySearch
              const sample = column ? (rows[0]?.[column] ?? '') : ''
              return (
                <div key={key} className="mapping-row">
                  <span className={`csv ${column ? '' : 'empty'}`}>
                    {column ? (
                      <>
                        &quot;{column}&quot;
                        {sample && <span className="ex">{sample.slice(0, 24)}{sample.length > 24 ? '…' : ''}</span>}
                      </>
                    ) : (
                      <>— non mappée —</>
                    )}
                  </span>
                  <span className="arr">→</span>
                  <span className="role">
                    {FIELD_LABELS[key]}
                    {column && <span className="auto">AUTO</span>}
                    {!column && isRequired && <span className="miss">REQUIS</span>}
                    {!column && exaRequired && <span className="miss">REQUIS POUR EXA</span>}
                    {!column && !isRequired && !exaRequired && <span className="opt">optionnel</span>}
                  </span>
                  <select
                    className="mapping-select"
                    value={column}
                    onChange={e => updateFieldMapping(key, e.target.value)}
                  >
                    <option value="">—</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )
            })}

            {customFields.map(field => (
              <div key={field.id} className="mapping-custom-row">
                <input
                  type="text"
                  className="field"
                  style={{ background: 'var(--paper-soft)', fontSize: 12.5, padding: '6px 10px' }}
                  placeholder="Libellé (ex: Secteur)"
                  value={field.label}
                  onChange={e => updateCustomField(field.id, { label: e.target.value })}
                />
                <span className="arr">→</span>
                <select
                  className="mapping-select"
                  value={field.column}
                  onChange={e => updateCustomField(field.id, { column: e.target.value })}
                >
                  <option value="">— colonne CSV —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeCustomField(field.id)}
                >
                  retirer
                </button>
              </div>
            ))}

            <button type="button" className="mapping-add" onClick={addCustomField}>
              <span>+</span>
              <span>ajouter un champ personnalisé</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--ink-4)' }}>
                passé au LLM en contexte
              </span>
            </button>
          </div>

          {/* IV · Instruction */}
          <div className="section">
            <h2><span className="n">IV.</span>Instruction</h2>
            <span className="meta">1 à 3 phrases en langage naturel</span>
          </div>

          <div className="field-group">
            <textarea
              className="field"
              placeholder="Ex : Cette personne a-t-elle changé de poste au cours des six derniers mois ? Si oui, indique le nouveau rôle et la nouvelle entreprise. Vide si introuvable."
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 18, marginTop: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field-group" style={{ flex: '0 0 auto' }}>
              <span className="field-label">Format de sortie</span>
              <div className="toggle">
                <button type="button" className={outputFormat === 'text' ? 'active' : ''} onClick={() => setOutputFormat('text')}>Texte</button>
                <button type="button" className={outputFormat === 'number' ? 'active' : ''} onClick={() => setOutputFormat('number')}>Nombre</button>
                <button type="button" className={outputFormat === 'boolean' ? 'active' : ''} onClick={() => setOutputFormat('boolean')}>Booléen</button>
              </div>
            </div>
            <div className="field-group" style={{ flex: 1, minWidth: 240 }}>
              <span className="field-label">
                Notes supplémentaires{' '}
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--ink-4)' }}>
                  (facultatif)
                </span>
              </span>
              <input
                className="field"
                placeholder="ex : ignore tout ce qui date d'avant 2024"
                value={additionalNotes}
                onChange={e => setAdditionalNotes(e.target.value)}
              />
            </div>
          </div>

          {/* V · Paramètres */}
          <div className="section">
            <h2><span className="n">V.</span>Paramètres</h2>
            <span className="meta">modèle · recherche · sortie</span>
          </div>

          <div className="field-group">
            <span className="field-label">Modèle</span>
            {availableModels.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--cherry)' }}>
                Aucune clé API enregistrée — ajoute Anthropic ou OpenAI dans{' '}
                <Link href="/settings">Réglages</Link> pour activer un modèle.
              </div>
            ) : (
              <div className="model-list">
                {MODEL_REGISTRY.map(m => {
                  const hasKey =
                    m.provider === 'anthropic' ? !!anthropicKey : !!openaiKey
                  const checked = model === m.id
                  return (
                    <label
                      key={m.id}
                      className={`model-option ${checked ? 'active' : ''} ${hasKey ? '' : 'disabled'} ${m.provider}`}
                    >
                      <input
                        type="radio"
                        name="enricher-model"
                        value={m.id}
                        checked={checked}
                        disabled={!hasKey}
                        onChange={() => setModel(m.id)}
                      />
                      <span className="model-name">
                        {m.label}
                        <span className="model-tier">{m.tier}</span>
                      </span>
                      <span className="model-hint">
                        {hasKey ? m.hint : `clé ${m.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} manquante`}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 22 }}>
            <div className="stack-3">
              <span className="field-label">Recherche web</span>
              <label className={`switch ${mapping.company_website ? '' : 'disabled'}`}>
                <input
                  type="checkbox"
                  checked={exaCompanySearch && !!mapping.company_website}
                  disabled={!mapping.company_website}
                  onChange={e => setExaCompanySearch(e.target.checked)}
                />
                <span className="track" />
                <span className="body">
                  <span className="lbl">Exa · site entreprise</span>
                  <span className="hint">
                    ~3× moins cher · cherche uniquement sur le domaine mappé
                    {!mapping.company_website && (
                      <> · <span style={{ color: 'var(--cherry)' }}>nécessite que «&nbsp;Site web entreprise&nbsp;» soit mappé</span></>
                    )}
                  </span>
                </span>
              </label>
              {exaCompanySearch && mapping.company_website && !exaKey && (
                <div style={{ fontSize: 12, color: 'var(--cherry)', marginLeft: 50 }}>
                  ⚠ Aucune clé Exa configurée — ajoute-la dans{' '}
                  <Link href="/settings">Réglages</Link>.
                </div>
              )}
              <label className="switch">
                <input
                  type="checkbox"
                  checked={exaWebSearch}
                  onChange={e => setExaWebSearch(e.target.checked)}
                />
                <span className="track" />
                <span className="body">
                  <span className="lbl">Exa · web ouvert</span>
                  <span className="hint">
                    recherche sur tout le web (news, articles, profils) · pas besoin de site mappé
                  </span>
                </span>
              </label>
              {exaWebSearch && !exaKey && (
                <div style={{ fontSize: 12, color: 'var(--cherry)', marginLeft: 50 }}>
                  ⚠ Aucune clé Exa configurée — ajoute-la dans{' '}
                  <Link href="/settings">Réglages</Link>.
                </div>
              )}
              <label className="switch">
                <input
                  type="checkbox"
                  checked={nativeWebSearch}
                  onChange={e => setNativeWebSearch(e.target.checked)}
                />
                <span className="track" />
                <span className="body">
                  <span className="lbl">Recherche web native</span>
                  <span className="hint">
                    via le provider du modèle · couvre tout le web · plus cher (
                    {getModel(model)?.provider === 'openai' ? '~0,025 €/appel' : '~0,01 €/appel'})
                  </span>
                </span>
              </label>
            </div>

            <div className="stack-3">
              <span className="field-label">Sortie</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={includeReasoning}
                  onChange={e => setIncludeReasoning(e.target.checked)}
                />
                <span className="track" />
                <span className="body">
                  <span className="lbl">Colonne «&nbsp;reasoning&nbsp;»</span>
                  <span className="hint">force le LLM à citer sa source en une phrase</span>
                </span>
              </label>
            </div>
          </div>

          {/* VI · Test & lancer */}
          <div className="section">
            <h2><span className="n">VI.</span>Test &amp; lancement</h2>
            <span className="meta">test obligatoire avant le batch</span>
          </div>

          <div className="cost-panel">
            <div>
              <span className="lbl">Avant lancement</span>
              <div className="val">test sur 5 lignes</div>
              <div className="hint">
                un aperçu gratuit (ou presque) pour vérifier la qualité avant le batch
              </div>
            </div>
            <div className="ctas">
              <button type="submit" disabled={!canSubmit} className="btn btn-primary btn-lg">
                Tester sur {Math.min(5, rows.length)} {mode === 'company' ? 'entreprises' : 'lignes'} →
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  )
}
