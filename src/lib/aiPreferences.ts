// AI personalization preferences — modes & models the user has enabled,
// blacklisted or favorited. Persisted in the `ai_preferences` table and
// consumed by the slash menu, model picker, /page command and the chat
// edge function (via the `aiPrefs` payload field).

import { MODELS, PROVIDERS, type Provider } from "@/lib/models";

export type ModeId = "note" | "page" | "explore" | "map" | "web";

export const MODE_DEFS: { id: ModeId; label: string; description: string }[] = [
  { id: "note", label: "Note (/note)", description: "Open an editable canvas for drafting" },
  { id: "page", label: "Page (/page)", description: "Generate a structured one-pager" },
  { id: "explore", label: "Explore (/explore)", description: "Side exploration thread" },
  { id: "map", label: "Maps", description: "Render interactive maps in answers" },
  { id: "web", label: "Web search", description: "Browse the web for fresh facts" },
];

export type AiPreferences = {
  disabledModes: ModeId[];
  blacklistedModels: string[];
  favoriteModels: string[];
};

export const DEFAULT_AI_PREFS: AiPreferences = {
  disabledModes: [],
  blacklistedModels: [],
  favoriteModels: [],
};

/** All known model ids across providers (used for validation + UI lists). */
export function allModelIds(): { id: string; label: string; provider: Provider }[] {
  const out: { id: string; label: string; provider: Provider }[] = [];
  for (const p of PROVIDERS) {
    for (const m of MODELS[p.id]) {
      out.push({ id: m.id, label: m.label, provider: p.id });
    }
  }
  return out;
}

export function isModeDisabled(prefs: AiPreferences | null | undefined, mode: ModeId): boolean {
  return !!prefs?.disabledModes?.includes(mode);
}

export function isModelBlacklisted(prefs: AiPreferences | null | undefined, modelId: string): boolean {
  return !!prefs?.blacklistedModels?.includes(modelId);
}

/** Pick the first allowed model, preferring favorites then `fallbackOrder`. */
export function pickAllowedModel(
  prefs: AiPreferences | null | undefined,
  preferred: string,
  fallbackOrder: string[],
): string {
  const blacklist = new Set(prefs?.blacklistedModels ?? []);
  if (!blacklist.has(preferred)) return preferred;
  for (const fav of prefs?.favoriteModels ?? []) {
    if (!blacklist.has(fav)) return fav;
  }
  for (const id of fallbackOrder) {
    if (!blacklist.has(id)) return id;
  }
  // Last resort: first non-blacklisted known model
  const all = allModelIds().map((m) => m.id);
  return all.find((id) => !blacklist.has(id)) ?? preferred;
}
