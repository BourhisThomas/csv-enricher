'use client'

import type { EnrichmentResult } from '@/lib/enricher/types'

interface Props {
  results: EnrichmentResult[]
  totalRows: number
  totalUnits: number
  unitLabel: string
  onBackToForm: () => void
  onLaunch: () => void
  isLaunching: boolean
}

export default function EnricherPreview({
  results,
  totalRows,
  totalUnits,
  unitLabel,
  onBackToForm,
  onLaunch,
  isLaunching,
}: Props) {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold mb-1">Aperçu — {results.length} résultats</h2>
        <p className="text-sm text-gray-600">
          Vérifie la qualité avant de lancer sur l&apos;ensemble du fichier. Si le résultat ne convient pas, retourne au form pour ajuster.
        </p>
      </div>

      <div className="space-y-3">
        {results.map((r, i) => (
          <div key={i} className={`border rounded-lg p-4 ${r.error ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-medium">{r.display_name || `Ligne ${r.row_index + 1}`}</span>
              {r.company && <span className="text-sm text-gray-500">— {r.company}</span>}
            </div>
            {r.error ? (
              <div className="text-sm text-red-700">Erreur : {r.error}</div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap">{r.output || '—'}</p>
                {r.reasoning && (
                  <p className="mt-2 text-xs text-gray-500 italic">{r.reasoning}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
        Lancer sur tout le fichier traitera <strong>{totalRows} lignes</strong>
        {totalUnits !== totalRows && <> ({totalUnits} {unitLabel} uniques après dédup)</>}.
        Tu seras facturé directement par Anthropic / OpenAI selon ton usage.
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBackToForm}
          disabled={isLaunching}
          className="flex-1 py-3 border border-gray-300 rounded-md font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Modifier la config
        </button>
        <button
          type="button"
          onClick={onLaunch}
          disabled={isLaunching}
          className="flex-1 py-3 bg-black text-white rounded-md font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          Lancer sur {totalRows} lignes
        </button>
      </div>
    </div>
  )
}
