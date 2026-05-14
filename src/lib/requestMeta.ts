// Shared type describing what was sent to the LLM for a given assistant turn.
// Emitted by the `chat` edge function as a `meta` SSE event, and rendered by
// the `RequestVisualizer` component below the assistant reply.

export type MetaSystem = {
  label: string;
  content: string;
  approxTokens: number;
  description?: string;
};

export type MetaHistoryEntry = {
  role: "user" | "assistant" | "system";
  content: string;
  approxTokens: number;
  attachments?: { kind: "image" | "text"; name: string; mime: string }[];
};

export type MetaMemoryMatch = {
  kind: string;
  content: string;
  score: number;
};

export type MetaWebContext = {
  kind: "scrape" | "search";
  label: string;
  approxTokens: number;
};

export type MetaCost = {
  inputTokens: number;
  outputTokens: number;
  /** Provider list cost (USD) before Lovable markup. */
  inputCostUsd: number;
  outputCostUsd: number;
  /** Markup applied for this model (e.g. 3 = ×3). */
  multiplier: number;
};

export type RequestMeta = {
  provider: string;
  model: string;
  systems: MetaSystem[];
  history: MetaHistoryEntry[];
  memoryKeywords: string[];
  memoryMatches: MetaMemoryMatch[];
  webContext: MetaWebContext | null;
  approxTotalInputTokens: number;
  cost?: MetaCost;
};
