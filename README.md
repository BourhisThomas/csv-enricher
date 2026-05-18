# csv-enricher

> Enrichis tes CSV de prospects ou d'entreprises B2B avec **Claude** ou **GPT** — apporte tes propres clés API, tout tourne en local.

Tu uploades un CSV, tu décris l'info que tu veux extraire/déduire en langage naturel, et l'app appelle Anthropic ou OpenAI pour remplir les colonnes manquantes ligne par ligne. Deux options de recherche web indépendantes :

- **Recherche site entreprise (Exa)** — le LLM peut chercher dans les pages du site web officiel de l'entreprise via [Exa](https://exa.ai). ~3× moins cher que les web search natifs des LLMs. Nécessite une clé Exa BYOK.
- **Recherche web générale (native)** — fallback sur `web_search_20250305` (Anthropic) ou `web_search_preview` (OpenAI). Plus cher mais couvre tout le web (news, profils publics, etc.).

## Quickstart

```bash
git clone <repo-url>
cd csv-enricher
npm install
npm run dev
```

Ouvre <http://localhost:3000>, va dans **Settings**, colle ta clé Anthropic ([console.anthropic.com](https://console.anthropic.com/settings/keys)) et/ou ta clé OpenAI ([platform.openai.com](https://platform.openai.com/api-keys)), et optionnellement ta clé Exa ([dashboard.exa.ai](https://dashboard.exa.ai/api-keys)) si tu veux activer la recherche site entreprise. Uploade un CSV, écris ton instruction.

## Comment ça marche

- **BYOK** : tes clés API vivent dans le `localStorage` de ton navigateur. Elles sont envoyées en header HTTP au backend Next.js (qui tourne en local), jamais persistées côté serveur.
- **Modes** :
  - *Prospect* — 1 ligne = 1 appel LLM
  - *Entreprise* — déduplication par société (1 appel par entreprise unique, fan-out aux lignes partageant la même société)
- **Recherche** : deux options indépendantes, activables séparément
  - *Exa* — tool `search_company_website(query)` exposé au LLM, restreint au domaine du `company_website` de la ligne. Le LLM décide quand chercher (cap 5 itérations / ligne)
  - *Native* — `web_search_20250305` (Anthropic) ou `web_search_preview` (OpenAI), web search type SERP
- **Estimation de coût** : après le test sur 5 lignes, l'app calcule le coût réel en € et extrapole pour le batch complet (tarifs en dur dans `src/lib/pricing.ts`)
- **Output** : texte libre, nombre, ou booléen. Option "Reasoning" pour ajouter une colonne avec la source citée par le modèle.

Un `public/sample.csv` est fourni pour tester immédiatement.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- `@anthropic-ai/sdk` + `openai` (Responses API)

## Limites

- Cap par batch : 1000 lignes (configurable dans `src/app/api/enrich/generate/route.ts`)
- Concurrence : 3 appels LLM en parallèle (configurable dans `src/lib/enricher/generator.ts`)
- L'app ne stocke rien : si tu fermes l'onglet pendant un run, tu perds les résultats partiels

## Déployer

Vercel marche out-of-the-box. **Important** : ne configure **pas** de variable d'env avec ta clé API si tu déploies publiquement — le BYOK est conçu pour que chaque utilisateur fournisse sa propre clé via Settings.

```bash
vercel deploy
```

## License

MIT — voir [LICENSE](./LICENSE).
