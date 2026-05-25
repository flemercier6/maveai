## Goal

Remplacer le mode Reflexion actuel (pré-planifié : plan → hypothesis → search → … → synthesize, bornes en nombre de steps) par une vraie boucle **ReAct dynamique** : à chaque tour, le modèle choisit lui-même l'action suivante (continuer à réfléchir, appeler un outil, ou finaliser la réponse) jusqu'à épuisement du budget ou décision d'arrêt.

## Effort = budget de tokens (pas de steps pré-définis)

| Effort | Budget tokens de raisonnement | Hard cap d'itérations (anti-runaway) |
|--------|-------------------------------|--------------------------------------|
| low    | ~3 000 tokens                 | 6                                    |
| medium | ~12 000 tokens                | 15                                   |
| high   | ~40 000 tokens                | 30                                   |

Le hard cap est un garde-fou (boucle infinie / coût). Tant que le budget tokens n'est pas atteint **et** que le modèle dit qu'il a encore besoin de chercher, la boucle continue.

## Outils disponibles dans la boucle

- `web_search(query)` — Linkup
- `web_fetch(url)` — Linkup
- `memory_recall(query)` — recherche dans `allFetchedMemRows`
- `google_tools(...)` — réutiliser le routeur Google existant (Calendar/Gmail/Docs) si `googleService` est actif sur le turn
- `finish()` — sortir de la boucle et passer à la rédaction finale

## Boucle ReAct (dans `supabase/functions/chat/index.ts`)

À chaque itération, on appelle un **modèle orchestrateur** (Gemini 3 Flash via la passerelle Lovable AI) avec :
- la question utilisateur + sa langue
- l'historique des `{thought, action, observation}` accumulés
- la liste des outils disponibles + budget restant (tokens & itérations)
- consigne : produire un JSON `{ thought: string, action: { tool, args } | { tool: "finish" } }`

Format de chaque itération :
1. **Thought** — court paragraphe (1-3 phrases) sur ce qu'il vient d'apprendre et ce qu'il veut faire ensuite, dans la langue du user. **Streamé en live** vers le client.
2. **Action** — outil + args, ou `finish`.
3. **Observation** — résultat structuré de l'outil (nb sources, extrait, échec…), réinjecté au tour suivant.

Conditions d'arrêt :
- Le modèle renvoie `finish`.
- Tokens cumulés de raisonnement ≥ budget effort.
- Nombre d'itérations ≥ hard cap.
- Erreur outil répétée 2× de suite.

À la fin de la boucle : tout le contexte gathered (sources, mémoires, scrapes) est passé au modèle principal (celui choisi par l'utilisateur) qui rédige la réponse finale — comme aujourd'hui.

## Streaming UI — format ligne unique par action

Format demandé : `[icône] [titre] · [détails]`. Côté backend on émet déjà des events `agent_step` ; je remplace par un format plus compact + thought streamé :

- `agent_step` (running) au lancement de l'outil → ligne ex. `🔍 Recherche web · "prix iPhone 17 France"`
- `agent_step` (done) avec foundCount → `🔍 Recherche web · 8 sources trouvées`
- `agent_thought` (nouveau type, streamé token par token) → ligne `💭 Réflexion · <thought streamé>`
- `agent_step` (finish) → ligne `✓ Réponse prête`

Côté frontend (`ChatMessage.tsx`), `AgentStepCard` est remplacé par une **ligne compacte** (pas de carte repliable) : icône à gauche (16px), titre semi-bold, séparateur `·`, détails en `text-muted-foreground`. Hauteur fixe ~22px, gap 6px entre lignes. Les `thought` apparaissent en italique grisé et se mettent à jour en live pendant le stream.

## Refactor — ce qui dégage

- `decideReflexionPlan` → supprimé.
- Le bloc `actionableSteps` + boucle for séquentielle pour Reflexion → remplacé par la boucle ReAct dynamique.
- `decideAgenticPlan` (mode auto sans Reflexion) → **conservé tel quel**, on ne touche pas à ce flow.
- `streamAgenticNarration` → conservé pour le mode auto ; pour Reflexion on utilise un nouveau `streamReactThought` (plus court, ciblé sur "qu'est-ce que je viens d'apprendre / que faire ensuite").
- Type `AgentStep` (frontend) → ajout d'un kind `"thought"` et `"finish"`.

## Fichiers touchés

- `supabase/functions/chat/index.ts` — nouvelle fonction `runReactLoop(...)` + branchement quand `reflexionEnabled`. Suppression de `decideReflexionPlan`.
- `src/components/ChatMessage.tsx` — `AgentStepCard` → `AgentStepLine` compact ; gérer `kind: "thought" | "finish"`.
- `src/pages/Chat.tsx` — étendre le type `AgentStep`, gérer event `agent_thought` (append à la dernière ligne thought ou créer une nouvelle).

## Points hors scope (sauf demande)

- Le mode auto (non-Reflexion) garde son comportement actuel.
- Pas de changement à la sélection de modèle de réponse finale.
- Pas de modification du coût/quotas affichés.

## Risques & garde-fous

- **Coût** : le hard cap d'itérations + budget tokens empêchent les boucles infinies. Chaque appel orchestrateur est court (~200-500 tokens out).
- **Latence high effort** : 30 itérations max peuvent prendre 30-60s. Le streaming en temps réel masque la latence.
- **Outils Google** : si pas connectés, ne sont pas exposés à l'orchestrateur (filtrés dynamiquement comme le sont déjà search/scrape/memory).