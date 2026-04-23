// Available models per provider — defaults set to latest flagship
export type Provider = "openai" | "anthropic" | "google";

export const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "openai", label: "ChatGPT" },
  { id: "anthropic", label: "Claude" },
  { id: "google", label: "Gemini" },
];

export type ModelOption = { id: string; label: string; description: string };

export const MODELS: Record<Provider, ModelOption[]> = {
  openai: [
    { id: "gpt-5.4", label: "GPT 5.4", description: "OpenAI's latest model" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", description: "OpenAI's fastest model" },
  ],
  anthropic: [
    { id: "claude-opus-4-7", label: "Opus 4.7", description: "Anthropic's most capable model" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Anthropic's fastest model" },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Google's most capable model" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Google's fastest model" },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-7",
  google: "gemini-2.5-pro",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
};

// Special "Auto" sentinel — handled by routeAuto() before sending
export const AUTO_MODEL_ID = "auto";

// Helper: get a model's display label from its id
export function modelLabel(modelId: string): string {
  for (const p of PROVIDERS) {
    const m = MODELS[p.id].find((x) => x.id === modelId);
    if (m) return m.label;
  }
  return modelId;
}

// Helper: find provider for a model id
export function providerForModel(modelId: string): Provider {
  for (const p of PROVIDERS) {
    if (MODELS[p.id].some((m) => m.id === modelId)) return p.id;
  }
  return "openai";
}

/**
 * Heuristic router for the "Auto" mode.
 * Evaluated in order — first match wins.
 * Returns { provider, model } to actually call.
 */
export function routeAuto(message: string): { provider: Provider; model: string } {
  const text = message.trim();
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sentenceCount = (text.match(/[.!?]+/g) || []).length || 1;
  const hasCode = /```|\bfunction\b|\bclass\b|=>|;\s*$|<\/?\w+>|console\.log|def\s+\w+\(/i.test(text);
  const hasImageOrFile = /\b(image|photo|picture|screenshot|file|pdf|attached|attachment|document)\b/i.test(lower);
  const mentionsGoogle = /\b(google|gmail|gdocs|google docs|google sheets|google drive|youtube|android)\b/i.test(lower);
  const wantsStructured = /\b(table|chart|spreadsheet|csv|json|parse|extract)\b/i.test(lower);
  const multiStep = /\b(first[,.\s].*then[,.\s].*(finally|lastly|after that))\b/i.test(lower)
    || /\bstep\s*1\b.*\bstep\s*2\b/i.test(lower);
  const heavyDomain = /\b(architecture|system design|legal|contract|financial|medical|diagnos|clinical|jurispr)\b/i.test(lower);
  const deepCritique = /\b(deep (critique|analysis|review)|exhaustive|comprehensive analysis|in-?depth)\b/i.test(lower);
  const creative = /\b(story|storytelling|poem|novel|marketing copy|brainstorm|tagline|slogan|creative|imagine|ideation)\b/i.test(lower);
  const shortCreative = /\b(rewrite|translate|emoji|one-?liner|short list|quick list|tweet)\b/i.test(lower);
  const conversational = /^(hi|hello|hey|yo|salut|bonjour|hola|thanks|thank you|ok|okay|yes|no|sure|cool|nice)\b/i.test(lower)
    || /^what is\b/i.test(lower)
    || /^who is\b/i.test(lower);

  // 6. Opus — heavy reasoning / long docs / deep analysis
  if (wordCount > 500 || multiStep || heavyDomain || deepCritique) {
    return { provider: "anthropic", model: "claude-opus-4-7" };
  }

  // 1. Gemini fastest — short conversational
  if (
    sentenceCount <= 2 &&
    wordCount <= 25 &&
    !hasCode &&
    (conversational || /\?$/.test(text) === false || wordCount <= 8)
  ) {
    if (conversational || wordCount <= 12) {
      return { provider: "google", model: "gemini-2.5-flash" };
    }
  }

  // 3. Gemini Pro — image/file, Google products, structured data
  if (hasImageOrFile || mentionsGoogle || wantsStructured) {
    return { provider: "google", model: "gemini-2.5-pro" };
  }

  // 2. ChatGPT fastest — short creative / quick rewrites
  if (shortCreative && wordCount <= 40) {
    return { provider: "openai", model: "gpt-4o-mini" };
  }

  // 4. GPT 5.4 — creative / generative
  if (creative) {
    return { provider: "openai", model: "gpt-5.4" };
  }

  // 5. Sonnet 4.6 — default
  return { provider: "anthropic", model: "claude-sonnet-4-6" };
}
