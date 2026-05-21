// Available models per provider — defaults set to latest flagship
export type Provider = "openai" | "anthropic" | "google" | "mistral";

export const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "openai", label: "ChatGPT" },
  { id: "anthropic", label: "Claude" },
  { id: "google", label: "Gemini" },
  { id: "mistral", label: "Mistral" },
];

export type ModelOption = { id: string; label: string; description: string };

export const MODELS: Record<Provider, ModelOption[]> = {
  openai: [
    { id: "gpt-5.5", label: "GPT 5.5", description: "OpenAI's latest model" },
    { id: "gpt-5-nano", label: "GPT-5 Nano", description: "OpenAI's fastest model" },
  ],
  anthropic: [
    { id: "claude-opus-4-7", label: "Opus 4.7", description: "Anthropic's most capable model" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Anthropic's balanced model" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Anthropic's fastest model" },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Google's most capable model" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Google's latest fast model" },
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large", description: "Mistral's latest flagship model" },
    { id: "mistral-small-latest", label: "Mistral Small", description: "Mistral's fastest model" },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-opus-4-7",
  google: "gemini-2.5-pro",
  mistral: "mistral-large-latest",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  mistral: "Mistral",
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
 *
 * Cost-aware policy (cheapest → most expensive):
 *   1. Gemini 2.5 Flash       — ~$0.30/M in   (default & conversational)
 *   2. GPT-5 Nano            — ~$0.15/M in   (short creative / rewrites)
 *   3. Gemini 2.5 Pro         — ~$1.25/M in   (multimodal, structured, Google)
 *   4. GPT 5.5                — ~$2.50/M in   (creative / generative)
 *   5. Claude Sonnet 4.6      — ~$3.00/M in   (only when reasoning needed)
 *   6. Claude Opus 4.7        — ~$15/M in     (only for very heavy reasoning)
 *
 * Anthropic is reserved for cases where cheaper models clearly underperform.
 * Returns { provider, model } to actually call.
 */
export function routeAuto(message: string): { provider: Provider; model: string } {
  const text = message.trim();
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasCode = /```|\bfunction\b|\bclass\b|=>|;\s*$|<\/?\w+>|console\.log|def\s+\w+\(/i.test(text);
  const hasImageOrFile = /\b(image|photo|picture|screenshot|file|pdf|attached|attachment|document)\b/i.test(lower);
  const mentionsGoogle = /\b(google|gmail|gdocs|google docs|google sheets|google drive|youtube|android)\b/i.test(lower);
  const wantsStructured = /\b(table|chart|spreadsheet|csv|json|parse|extract|diagram|flowchart)\b/i.test(lower);
  const multiStep = /\b(first[,.\s].*then[,.\s].*(finally|lastly|after that))\b/i.test(lower)
    || /\bstep\s*1\b.*\bstep\s*2\b/i.test(lower);
  // Restricted: only the most demanding domains route to Anthropic
  const veryHeavyDomain = /\b(legal contract|case law|jurispr|medical diagnos|clinical trial|differential diagnosis)\b/i.test(lower);
  const deepCritique = /\b(deep (critique|analysis|review)|exhaustive|comprehensive analysis|in-?depth analysis)\b/i.test(lower);
  const creative = /\b(story|storytelling|poem|novel|marketing copy|brainstorm|tagline|slogan|creative|imagine|ideation)\b/i.test(lower);
  const shortCreative = /\b(rewrite|translate|emoji|one-?liner|short list|quick list|tweet)\b/i.test(lower);

  // 1. Opus — only for VERY heavy reasoning (long legal/medical docs, exhaustive analysis)
  //    Threshold raised from 500 → 1200 words to avoid overusing the most expensive model.
  if (wordCount > 1200 || (veryHeavyDomain && wordCount > 200) || (deepCritique && wordCount > 400)) {
    return { provider: "anthropic", model: "claude-opus-4-7" };
  }

  // 2. Sonnet — only when we genuinely need stronger reasoning than Gemini Pro can offer
  //    (multi-step plans on long inputs, or deep critique on medium-length text)
  if ((multiStep && wordCount > 150) || (deepCritique && wordCount > 100)) {
    return { provider: "anthropic", model: "claude-sonnet-4-6" };
  }

  // 3. Gemini Pro — multimodal, Google ecosystem, structured data, or longer reasoning
  if (hasImageOrFile || mentionsGoogle || wantsStructured || wordCount > 300 || hasCode) {
    return { provider: "google", model: "gemini-2.5-pro" };
  }

  // 4. GPT-5 Nano — short creative / quick rewrites (very cheap)
  if (shortCreative && wordCount <= 60) {
    return { provider: "openai", model: "gpt-5-nano" };
  }

  // 5. GPT 5.5 — creative / generative work where prose quality matters
  if (creative) {
    return { provider: "openai", model: "gpt-5.5" };
  }

  // 6. Default — Gemini 3.5 Flash (cheapest capable model)
  return { provider: "google", model: "gemini-3.5-flash" };
}
