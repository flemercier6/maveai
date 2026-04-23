// Available models per provider — defaults set to latest flagship
export type Provider = "openai" | "anthropic" | "google";

export const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
];

export const MODELS: Record<Provider, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-5.4", label: "GPT-5.4 (latest)" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7 (latest)" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (latest)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-7",
  google: "gemini-2.5-pro",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
};
