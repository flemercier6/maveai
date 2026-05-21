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
  /** Number of Linkup web searches performed during this turn. */
  webSearchCount?: number;
  /** Raw passthrough Linkup cost (USD), before markup. */
  webSearchCostUsd?: number;
};


/**
 * Per-model usage entry. When a request goes through a multi-model pipeline
 * (e.g. an Anthropic planner + an OpenAI content writer), each model
 * contributes one ModelUsage. The aggregate is also reflected in `cost`.
 */
export type ModelUsage = {
  provider: string;
  model: string;
  /** Functional role in the pipeline (e.g. "planner", "content"). */
  role: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
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
  /** Set when the request used more than one model in a pipeline. */
  models?: ModelUsage[];
};
