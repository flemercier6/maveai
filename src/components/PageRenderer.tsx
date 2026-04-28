// Editorial renderer for AI-generated one-pagers.
// Distinct visual identity — not the chat UI:
// • Warm paper palette (#F2EEE5 surface), vermillion + ink accents
// • Display: Instrument Serif (italic-friendly)
// • UI mono: Space Grotesk for eyebrows / labels
// • Magazine-style layout with column rules and oversized numerals
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PageBlock =
  | { type: "heading"; text: string; level?: 2 | 3 }
  | { type: "paragraph"; text: string }
  | {
      type: "callout";
      tone?: "info" | "success" | "warning" | "danger";
      title?: string;
      body: string;
    }
  | {
      type: "kpis";
      items: { label: string; value: string; hint?: string }[];
    }
  | {
      type: "checklist";
      items: { label: string; checked?: boolean }[];
    }
  | { type: "bullets"; bullets: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | {
      type: "chart";
      chartType: "bar" | "line" | "pie";
      title?: string;
      data: { name: string; value: number }[];
    };

export type PageTab = { label: string; blocks: PageBlock[] };

export type PageSpec = {
  title: string;
  subtitle?: string;
  tabs: PageTab[];
};

// Distinct palette — vermillion accent, deep ink, brass
const VERMILLION = "#E85A2F";
const INK = "#1B1A17";
const BRASS = "#B48441";
const TEAL = "#2E4057";
const SOFT = "#6B655A";

const CHART_PALETTE = [VERMILLION, TEAL, BRASS, "#5A6B5C", "#7A4A2B", "#A89684", "#9B2C2C"];

const calloutStyles: Record<string, { bar: string; bg: string; fg: string; chip: string }> = {
  info:    { bar: "bg-[#2E4057]",   bg: "bg-[#2E4057]/[0.06]", fg: "text-[#1B1A17]",  chip: "bg-[#2E4057] text-[#F2EEE5]" },
  success: { bar: "bg-[#5A6B5C]",   bg: "bg-[#5A6B5C]/[0.10]", fg: "text-[#2E3A2F]",  chip: "bg-[#5A6B5C] text-[#F2EEE5]" },
  warning: { bar: "bg-[#E85A2F]",   bg: "bg-[#E85A2F]/[0.08]", fg: "text-[#7A2A0E]",  chip: "bg-[#E85A2F] text-[#F2EEE5]" },
  danger:  { bar: "bg-[#9B2C2C]",   bg: "bg-[#9B2C2C]/[0.08]", fg: "text-[#7A1F1F]",  chip: "bg-[#9B2C2C] text-[#F2EEE5]" },
};

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("font-grotesk text-[10px] uppercase tracking-[0.24em] text-[#6B655A] font-medium", className)}>
      {children}
    </div>
  );
}

function Block({ block, index }: { block: PageBlock; index: number }) {
  switch (block.type) {
    case "heading": {
      if (block.level === 3) {
        return (
          <h3 className="font-display text-[22px] font-normal italic tracking-tight text-[#1B1A17] mt-8 mb-1">
            {block.text}
          </h3>
        );
      }
      return (
        <div className="mt-12 mb-4">
          <div className="flex items-baseline gap-4 border-b border-[#1B1A17]/20 pb-3">
            <span className="font-grotesk text-[11px] tabular-nums text-[#E85A2F] font-semibold tracking-wider">
              §{String(index + 1).padStart(2, "0")}
            </span>
            <h2 className="font-display text-[32px] leading-[1.05] font-normal tracking-tight text-[#1B1A17]">
              {block.text}
            </h2>
          </div>
        </div>
      );
    }

    case "paragraph":
      return (
        <p className="font-display text-[19px] leading-[1.55] text-[#1B1A17]/90 max-w-[62ch] first-letter:font-normal">
          {block.text}
        </p>
      );

    case "callout": {
      const tone = block.tone ?? "info";
      const s = calloutStyles[tone];
      return (
        <div className={cn("relative pl-5 pr-4 py-4 rounded-r-md", s.bg)}>
          <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", s.bar)} />
          {block.title && (
            <div className="mb-1.5">
              <span className={cn("inline-block font-grotesk text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-sm font-semibold", s.chip)}>
                {block.title}
              </span>
            </div>
          )}
          <div className={cn("font-display text-[16px] leading-[1.55]", s.fg)}>
            {block.body}
          </div>
        </div>
      );
    }

    case "kpis":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-[#1B1A17]/15 rounded-md overflow-hidden border border-[#1B1A17]/15">
          {block.items.map((it, i) => (
            <div key={i} className="bg-[#F8F4EB] px-5 py-5 relative">
              <Eyebrow>{it.label}</Eyebrow>
              <div className="mt-3 font-display text-[40px] leading-[0.95] font-normal text-[#1B1A17] tabular-nums">
                {it.value}
              </div>
              {it.hint && (
                <div className="mt-2 font-grotesk text-[11px] text-[#6B655A] leading-snug">
                  {it.hint}
                </div>
              )}
              <span className="absolute top-3 right-3 h-1 w-1 rounded-full bg-[#E85A2F]" />
            </div>
          ))}
        </div>
      );

    case "checklist":
      return (
        <ul className="space-y-3 border-l-2 border-[#E85A2F]/30 pl-5">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 text-[15px]">
              <Checkbox
                checked={!!it.checked}
                className="mt-[4px] border-[#1B1A17]/40 data-[state=checked]:bg-[#E85A2F] data-[state=checked]:border-[#E85A2F]"
                aria-label={it.label}
              />
              <span
                className={cn(
                  "font-display text-[17px] leading-relaxed",
                  it.checked ? "text-[#6B655A] line-through italic" : "text-[#1B1A17]",
                )}
              >
                {it.label}
              </span>
            </li>
          ))}
        </ul>
      );

    case "bullets":
      return (
        <ul className="space-y-2">
          {block.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-4 font-display text-[17px] leading-[1.55] text-[#1B1A17]/90">
              <span className="mt-[12px] inline-block h-[2px] w-4 bg-[#E85A2F] flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      );

    case "table":
      return (
        <div className="overflow-hidden border-y-2 border-[#1B1A17]/80">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-[#1B1A17]/30 bg-[#1B1A17]/[0.04]">
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    className="text-left px-4 py-3 font-grotesk text-[10px] uppercase tracking-[0.2em] text-[#1B1A17]/70 font-semibold"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-b border-[#1B1A17]/12 last:border-b-0 hover:bg-[#E85A2F]/[0.04] transition-colors">
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-4 py-3 align-top",
                        j === 0
                          ? "font-display text-[16px] text-[#1B1A17]"
                          : "font-grotesk text-[13px] text-[#1B1A17]/85",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "chart": {
      const data = block.data ?? [];
      return (
        <figure className="border border-[#1B1A17]/15 rounded-md bg-[#F8F4EB] p-6 relative overflow-hidden">
          <span className="absolute top-0 left-0 h-1 w-16 bg-[#E85A2F]" />
          {block.title && (
            <figcaption className="mb-5">
              <Eyebrow>Figure {String(index + 1).padStart(2, "0")}</Eyebrow>
              <div className="mt-1 font-display text-[20px] italic text-[#1B1A17]">
                {block.title}
              </div>
            </figcaption>
          )}
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              {block.chartType === "line" ? (
                <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1B1A17" strokeOpacity={0.15} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: SOFT, fontFamily: "Space Grotesk" }} axisLine={{ stroke: INK, strokeOpacity: 0.4 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: SOFT, fontFamily: "Space Grotesk" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", borderRadius: 4, fontSize: 12, color: "#F2EEE5", fontFamily: "Space Grotesk" }} labelStyle={{ color: "#F2EEE5" }} cursor={{ stroke: VERMILLION, strokeWidth: 1, strokeDasharray: "2 2" }} />
                  <Line type="monotone" dataKey="value" stroke={VERMILLION} strokeWidth={2} dot={{ r: 4, fill: VERMILLION, strokeWidth: 0 }} activeDot={{ r: 6, fill: INK, strokeWidth: 2, stroke: VERMILLION }} />
                </LineChart>
              ) : block.chartType === "pie" ? (
                <PieChart>
                  <Tooltip contentStyle={{ background: INK, border: "none", borderRadius: 4, fontSize: 12, color: "#F2EEE5", fontFamily: "Space Grotesk" }} />
                  <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} innerRadius={56} paddingAngle={2} stroke="#F8F4EB" strokeWidth={3}>
                    {data.map((_, i) => (<Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />))}
                  </Pie>
                </PieChart>
              ) : (
                <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1B1A17" strokeOpacity={0.15} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: SOFT, fontFamily: "Space Grotesk" }} axisLine={{ stroke: INK, strokeOpacity: 0.4 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: SOFT, fontFamily: "Space Grotesk" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: INK, border: "none", borderRadius: 4, fontSize: 12, color: "#F2EEE5", fontFamily: "Space Grotesk" }} cursor={{ fill: "rgba(232,90,47,0.08)" }} />
                  <Bar dataKey="value" fill={VERMILLION} radius={[3, 3, 0, 0]} maxBarSize={56} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </figure>
      );
    }

    default:
      return null;
  }
}

function BlockList({ blocks }: { blocks: PageBlock[] }) {
  let headingIndex = -1;
  return (
    <div className="space-y-6">
      {blocks.map((b, i) => {
        if (b.type === "heading" && (b.level ?? 2) === 2) headingIndex += 1;
        return <Block key={i} block={b} index={headingIndex < 0 ? i : headingIndex} />;
      })}
    </div>
  );
}

export function PageRenderer({ page }: { page: PageSpec }) {
  const tabs = page.tabs?.length ? page.tabs : [{ label: "Overview", blocks: [] }];
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase();

  return (
    <article className="max-w-[820px] mx-auto px-10 py-12 pb-20">
      {/* Editorial masthead */}
      <header className="mb-12">
        <div className="flex items-center justify-between mb-8 pb-3 border-b border-[#1B1A17]/30">
          <div className="font-grotesk text-[10px] uppercase tracking-[0.32em] text-[#1B1A17]/65 font-semibold">
            The Brief · Vol. 01
          </div>
          <div className="font-grotesk text-[10px] uppercase tracking-[0.32em] text-[#1B1A17]/65 tabular-nums font-semibold">
            {today}
          </div>
        </div>
        <div className="flex items-start gap-4">
          <span className="mt-3 inline-block h-3 w-3 rounded-full bg-[#E85A2F] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-[56px] sm:text-[64px] leading-[0.98] font-normal tracking-[-0.015em] text-[#1B1A17]">
              {page.title}
            </h1>
            {page.subtitle && (
              <p className="mt-4 font-display italic text-[22px] leading-[1.4] text-[#1B1A17]/65 max-w-[58ch]">
                {page.subtitle}
              </p>
            )}
          </div>
        </div>
      </header>

      {tabs.length === 1 ? (
        <BlockList blocks={tabs[0].blocks} />
      ) : (
        <Tabs defaultValue="0" className="w-full">
          <TabsList className="bg-transparent p-0 h-auto gap-7 border-b border-[#1B1A17]/25 rounded-none w-full justify-start mb-10">
            {tabs.map((t, i) => (
              <TabsTrigger
                key={i}
                value={String(i)}
                className={cn(
                  "rounded-none bg-transparent px-0 pb-3 pt-0 -mb-px",
                  "font-grotesk text-[11px] uppercase tracking-[0.22em] text-[#1B1A17]/55 font-semibold",
                  "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  "data-[state=active]:text-[#1B1A17] data-[state=active]:border-b-2 data-[state=active]:border-[#E85A2F]",
                )}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t, i) => (
            <TabsContent key={i} value={String(i)} className="mt-0">
              <BlockList blocks={t.blocks} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Footer mark */}
      <footer className="mt-20 pt-6 border-t border-[#1B1A17]/30 flex items-center justify-between">
        <div className="font-grotesk text-[10px] uppercase tracking-[0.32em] text-[#1B1A17]/55 font-semibold">
          — Fin —
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#E85A2F]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#B48441]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#2E4057]" />
        </div>
      </footer>
    </article>
  );
}
