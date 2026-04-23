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
    { id: "gemini-3.5-pro", label: "Gemini 3.5 Pro", description: "Google's latest model" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Google's fastest model" },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-7",
  google: "gemini-3.5-pro",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
};

// Helper: find provider for a model id
export function providerForModel(modelId: string): Provider {
  for (const p of PROVIDERS) {
    if (MODELS[p.id].some((m) => m.id === modelId)) return p.id;
  }
  return "openai";
}
