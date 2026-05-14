import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Plus, Pencil, Search } from "lucide-react";
import type { RequestMeta } from "@/lib/requestMeta";

type Props = {
  meta?: RequestMeta;
  memory?: { added: number; updated: number };
};

/**
 * Collapsible card shown under an assistant reply that explains how memory
 * was *considered* for context (retrieved memories + keywords used) and how
 * it was *saved* after this turn (added / updated counts).
 *
 * Goal: give the user transparency on what the model "knew" about them and
 * what it just learned.
 */
export function MemoryInsights({ meta, memory }: Props) {
  const [open, setOpen] = useState(false);

  const matches = meta?.memoryMatches ?? [];
  const keywords = meta?.memoryKeywords ?? [];
  const added = memory?.added ?? 0;
  const updated = memory?.updated ?? 0;
  const consideredCount = matches.length;
  const savedCount = added + updated;

  // Hide entirely when there is nothing meaningful to say.
  if (consideredCount === 0 && savedCount === 0 && keywords.length === 0) return null;

  const summaryBits: string[] = [];
  if (consideredCount > 0) summaryBits.push(`${consideredCount} considered`);
  if (added > 0) summaryBits.push(`${added} added`);
  if (updated > 0) summaryBits.push(`${updated} edited`);
  const summary = summaryBits.join(" · ") || "no change";

  return (
    <div className="mt-2 rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-dropdown-hover transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-sm text-foreground">
          <Brain className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium">Memory</span>
          <span className="text-muted-foreground">· {summary}</span>
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
          {/* ---- Considered ---- */}
          <Section
            icon={<Search className="w-3.5 h-3.5" />}
            title="Considered for context"
            description={
              consideredCount > 0
                ? "Memories injected into the system prompt, ranked by relevance to your message."
                : "No stored memory matched your message — nothing was injected."
            }
          >
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center h-5 px-2 rounded-full bg-muted text-xs text-muted-foreground"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            {matches.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {matches.map((m, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <span className="mt-0.5 inline-flex items-center justify-center h-4 px-1.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground shrink-0">
                      {Math.round(m.score * 100)}%
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-muted-foreground uppercase tracking-wide">
                        {m.kind}
                      </span>
                      <span className="block text-sm text-foreground leading-snug">
                        {m.content}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ---- Saved ---- */}
          <Section
            icon={<Plus className="w-3.5 h-3.5" />}
            title="Saved from this turn"
            description={
              savedCount > 0
                ? "New facts written to memory, deduped against existing entries by semantic similarity."
                : "Nothing new worth remembering was detected in this exchange."
            }
          >
            {savedCount > 0 && (
              <div className="flex flex-wrap gap-2">
                {added > 0 && (
                  <Pill icon={<Plus className="w-3 h-3" />} label={`${added} new`} />
                )}
                {updated > 0 && (
                  <Pill icon={<Pencil className="w-3 h-3" />} label={`${updated} reinforced`} />
                )}
              </div>
            )}
          </Section>

          <p className="text-xs text-muted-foreground leading-snug">
            Scoring: keyword overlap × recency × confidence. Top {matches.length || "N"} entries
            (≥ threshold) are injected. Saving runs a mini-LLM judge then dedupes by embedding
            cosine similarity.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{description}</p>
      {children}
    </div>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-border bg-background text-xs text-foreground">
      {icon}
      {label}
    </span>
  );
}
