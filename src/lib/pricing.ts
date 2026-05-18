import {
  getModel,
  type ApiUsage,
  type EnricherModel,
  type ModelProvider,
} from './enricher/types'

export const USD_TO_EUR = 0.92

export const ANTHROPIC_NATIVE_WEB_SEARCH_USD_PER_CALL = 0.01
export const OPENAI_NATIVE_WEB_SEARCH_USD_PER_CALL = 0.025
export const EXA_USD_PER_CALL = 0.008

export interface CostBreakdown {
  tokens_usd: number
  native_search_usd: number
  exa_usd: number
  total_usd: number
  total_eur: number
}

function providerTokens(provider: ModelProvider, usage: ApiUsage): { input: number; output: number } {
  if (provider === 'anthropic') {
    return { input: usage.anthropic_in ?? 0, output: usage.anthropic_out ?? 0 }
  }
  return { input: usage.openai_in ?? 0, output: usage.openai_out ?? 0 }
}

export function computeCost(model: EnricherModel, usage: ApiUsage): CostBreakdown {
  const descriptor = getModel(model)
  if (!descriptor) {
    return { tokens_usd: 0, native_search_usd: 0, exa_usd: 0, total_usd: 0, total_eur: 0 }
  }
  const { input, output } = providerTokens(descriptor.provider, usage)
  const tokens =
    (input * descriptor.pricing_usd_per_m.input + output * descriptor.pricing_usd_per_m.output) /
    1_000_000

  const nativePerCall =
    descriptor.provider === 'anthropic'
      ? ANTHROPIC_NATIVE_WEB_SEARCH_USD_PER_CALL
      : OPENAI_NATIVE_WEB_SEARCH_USD_PER_CALL
  const native_search_usd = (usage.native_web_search_calls ?? 0) * nativePerCall
  const exa_usd = (usage.exa_calls ?? 0) * EXA_USD_PER_CALL
  const total_usd = tokens + native_search_usd + exa_usd

  return {
    tokens_usd: tokens,
    native_search_usd,
    exa_usd,
    total_usd,
    total_eur: total_usd * USD_TO_EUR,
  }
}

export function formatEur(value: number): string {
  if (value < 0.01) return '< 0,01 €'
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
