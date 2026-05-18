'use client'

import { computeCost, formatEur } from '@/lib/pricing'
import { getModel } from '@/lib/enricher/types'
import type { ApiUsage, EnricherModel, EnrichmentResult } from '@/lib/enricher/types'

interface Props {
  results: EnrichmentResult[]
  totalRows: number
  totalUnits: number
  unitLabel: string
  testUsage: ApiUsage | null
  testUnitCount: number
  model: EnricherModel
  onBackToForm: () => void
  onLaunch: () => void
  isLaunching: boolean
}

export default function EnricherPreview({
  results,
  totalRows,
  totalUnits,
  unitLabel,
  testUsage,
  testUnitCount,
  model,
  onBackToForm,
  onLaunch,
  isLaunching,
}: Props) {
  const cost = testUsage ? computeCost(model, testUsage) : null
  const projectedEur =
    cost && testUnitCount > 0
      ? (cost.total_eur / testUnitCount) * totalUnits
      : null

  const errorCount = results.filter(r => r.error).length
  const successCount = results.length - errorCount
  const hasReasoning = results.some(r => r.reasoning)
  const exaCalls = testUsage?.exa_calls ?? 0
  const totalTokens = testUsage
    ? (testUsage.anthropic_in ?? 0) +
      (testUsage.anthropic_out ?? 0) +
      (testUsage.openai_in ?? 0) +
      (testUsage.openai_out ?? 0)
    : 0
  const provider = getModel(model)?.provider ?? 'anthropic'

  return (
    <>
      <div className="section">
        <h2><span className="n">V.</span>Test &amp; lancement</h2>
        <span className="meta">aperçu sur {results.length} lignes</span>
      </div>

      <div className="test-result">
        <span className={`stamp ${errorCount > 0 ? 'fail' : ''}`}>
          {errorCount > 0 ? `${errorCount} erreur${errorCount > 1 ? 's' : ''}` : 'Vu · ok'}
        </span>
        <div className="row">
          <h3>
            {results.length} ligne{results.length > 1 ? 's' : ''} traitée{results.length > 1 ? 's' : ''} ·{' '}
            {successCount} OK{errorCount > 0 ? ` · ${errorCount} erreur${errorCount > 1 ? 's' : ''}` : ''}
          </h3>
          <span className="meta">
            {totalTokens > 0 && `${totalTokens.toLocaleString('fr-FR')} tokens`}
            {exaCalls > 0 && ` · ${exaCalls} appel${exaCalls > 1 ? 's' : ''} Exa`}
          </span>
        </div>

        <table className="ptable">
          <thead>
            <tr>
              <th>nom</th>
              <th>entreprise</th>
              <th className="added">output</th>
              {hasReasoning && <th className="added" style={{ width: '32%' }}>reasoning</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.display_name || `Ligne ${r.row_index + 1}`}</td>
                <td>{r.company || '—'}</td>
                {r.error ? (
                  <>
                    <td className="err" colSpan={hasReasoning ? 2 : 1}>{r.error}</td>
                  </>
                ) : (
                  <>
                    <td className="gen">{r.output || '—'}</td>
                    {hasReasoning && <td className="reasoning">{r.reasoning || '—'}</td>}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cost-panel">
        <div>
          <span className="lbl">Coût extrapolé · {totalUnits} {unitLabel}</span>
          <div className="val">
            {projectedEur !== null ? `~ ${formatEur(projectedEur)}` : '—'}
          </div>
          <div className="hint">
            {cost && (
              <>
                test : {formatEur(cost.total_eur)} pour {testUnitCount} {unitLabel}
                {totalRows !== totalUnits && (
                  <>{' '}· {totalRows} lignes au total ({totalUnits} après dédup)</>
                )}
              </>
            )}
            {' '}·{' '}facturé par {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}, pas par L&apos;Enricher
          </div>
        </div>
        <div className="ctas">
          <button
            type="button"
            onClick={onBackToForm}
            disabled={isLaunching}
            className="btn btn-secondary"
          >
            ↶ Modifier
          </button>
          <button
            type="button"
            onClick={onLaunch}
            disabled={isLaunching}
            className="btn btn-primary btn-lg"
          >
            Lancer sur {totalRows} ligne{totalRows > 1 ? 's' : ''} →
          </button>
        </div>
      </div>
    </>
  )
}
