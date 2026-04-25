// Per-model billing markup.
//
// Goal: keep the *billed* price per request roughly comparable across models,
// so cheap models still generate margin and expensive models stay competitive.
//
// Strategy: compute a "blended" provider price ($/M tokens, assuming a 3:1
// input:output ratio) and apply a dégressive markup:
//   - very cheap models   → high multiplier (up to ~6×)
//   - reference price     → ~3×
//   - very expensive ones → low multiplier (down to ~1.5×)
//
// The function is pure and works on any model id we know about, with a safe
// fallback (×3) for unknown ids.

type ProviderPrice = { input: number; output: number }; // USD per 1M tokens

// Public list prices (USD per 1M tokens). Keep this table in sync with
// supabase/functions/chat/index.ts pricing if it changes.
const PRICES: Record<string, ProviderPrice> = {
  // OpenAI
  "gpt-5.5": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Anthropic
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};

// Reference blended price (USD/M tokens) that maps to a ×3 multiplier.
// Picked roughly between Gemini Pro and Sonnet so that "average" models stay
// at the legacy ×3 markup.
const REFERENCE_BLENDED = 2.0;

const MIN_MULTIPLIER = 1.5;
const MAX_MULTIPLIER = 6;
const FALLBACK_MULTIPLIER = 3;

/** Blended cost in $/M tokens, weighted 75% input / 25% output. */
function blendedPrice(p: ProviderPrice): number {
  return p.input * 0.75 + p.output * 0.25;
}

/**
 * Markup multiplier applied on top of the provider list cost when billing
 * the user. Cheap models get a higher markup, expensive models a lower one.
 */
export function billingMultiplier(modelId: string): number {
  const price = PRICES[modelId];
  if (!price) return FALLBACK_MULTIPLIER;
  const blended = blendedPrice(price);
  if (blended <= 0) return FALLBACK_MULTIPLIER;
  // Inverse-proportional curve, anchored so REFERENCE_BLENDED → ×3.
  const raw = (REFERENCE_BLENDED / blended) * FALLBACK_MULTIPLIER;
  // Clamp to keep things sane on the extremes.
  const clamped = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, raw));
  // Round to 1 decimal so the UI shows clean values (×4.5, ×2.1…).
  return Math.round(clamped * 10) / 10;
}

/** Bill amount for a given base cost + model id. */
export function billedCost(baseCostUsd: number, modelId: string): number {
  return baseCostUsd * billingMultiplier(modelId);
}
