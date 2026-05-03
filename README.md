# csv-enricher

> Enrichis tes CSV de prospects ou d'entreprises B2B avec **Claude** ou **GPT** — apporte tes propres clés API, tout tourne en local.

Tu uploades un CSV, tu décris l'info que tu veux extraire/déduire en langage naturel, et l'app appelle Anthropic ou OpenAI pour remplir les colonnes manquantes ligne par ligne. Le LLM peut faire ses propres recherches web (via les outils `web_search` natifs d'Anthropic et OpenAI) — pas besoin de clé Exa, Serper, ou autre service tiers.

## Quickstart

```bash
git clone https://github.com/seeds-agency/csv-enricher
cd csv-enricher
npm install
npm run dev
```

Ouvre <http://localhost:3000>, va dans **Settings**, colle ta clé Anthropic ([console.anthropic.com](https://console.anthropic.com/settings/keys)) et/ou ta clé OpenAI ([platform.openai.com](https://platform.openai.com/api-keys)), uploade un CSV, écris ton instruction.

## Comment ça marche

- **BYOK** : tes clés API vivent dans le `localStorage` de ton navigateur. Elles sont envoyées en header HTTP au backend Next.js (qui tourne en local), jamais persistées côté serveur.
- **Modes** :
  - *Prospect* — 1 ligne = 1 appel LLM
  - *Entreprise* — déduplication par société (1 appel par entreprise unique, fan-out aux lignes partageant la même société)
- **Web search** : si activé, le LLM peut appeler son outil `web_search` natif (Anthropic `web_search_20250305` server-side, ou OpenAI Responses API `web_search_preview`) pour vérifier des éléments sur le web avant de répondre.
- **Output** : texte libre, nombre, ou booléen. Option "Reasoning" pour ajouter une colonne avec la source citée par le modèle.

Un `public/sample.csv` est fourni pour tester immédiatement.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- `@anthropic-ai/sdk` + `openai` (Responses API)

## Limites

- Cap par batch : 500 lignes (configurable dans `src/app/api/enrich/generate/route.ts`)
- Concurrence : 3 appels LLM en parallèle (configurable dans `src/lib/enricher/generator.ts`)
- L'app ne stocke rien : si tu fermes l'onglet pendant un run, tu perds les résultats partiels

## Déployer

Vercel marche out-of-the-box. **Important** : ne configure **pas** de variable d'env avec ta clé API si tu déploies publiquement — le BYOK est conçu pour que chaque utilisateur fournisse sa propre clé via Settings.

```bash
vercel deploy
```

## License

MIT — voir [LICENSE](./LICENSE).

---

Made by [seeds](https://seeds-agency.com) — agence growth & data B2B.
