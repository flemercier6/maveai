// Editorial renderer for AI-generated one-pagers.
// Distinct visual identity — not the chat UI:
// • Warm paper palette (#F2EEE5 surface), vermillion + ink accents
// • Display: Instrument Serif (italic-friendly)
// • UI mono: Space Grotesk for eyebrows / labels
// • Magazine-style layout with column rules and oversized numerals
import { createContext, useContext, useState } from "react";
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

export type PageTheme = "paper" | "midnight" | "minimal" | "forest" | "slate";

export type PageSpec = {
  title: string;
  subtitle?: string;
  tabs: PageTab[];
  theme?: PageTheme;
};

type ThemeTokens = {
  displayFont: string;    // Tailwind font class
  uiFont: string;
  text: string;           // primary text color (hex)
  textMuted: string;
  accent: string;         // primary accent (hex)
  accent2: string;
  surface: string;        // card/inset background
  border: string;
  chartPalette: string[];
  kpiBg: string;
  callout: Record<string, { bar: string; bg: string; fg: string; chip: string }>;
  tabActive: string;
  masthead: string;
  bulletLine: string;
};

const THEMES: Record<string, ThemeTokens> = {
  paper: {
    displayFont: "font-display",
    uiFont: "font-grotesk",
    text: "#1B1A17",
    textMuted: "#6B655A",
    accent: "#E85A2F",
    accent2: "#B48441",
    surface: "#F8F4EB",
    border: "rgba(27,26,23,0.15)",
    chartPalette: ["#E85A2F", "#2E4057", "#B48441", "#5A6B5C", "#7A4A2B", "#A89684", "#9B2C2C"],
    kpiBg: "#F8F4EB",
    callout: {
      info:    { bar: "bg-[#2E4057]",   bg: "bg-[#2E4057]/[0.06]", fg: "text-[#1B1A17]",  chip: "bg-[#2E4057] text-[#F2EEE5]" },
      success: { bar: "bg-[#5A6B5C]",   bg: "bg-[#5A6B5C]/[0.10]", fg: "text-[#2E3A2F]",  chip: "bg-[#5A6B5C] text-[#F2EEE5]" },
      warning: { bar: "bg-[#E85A2F]",   bg: "bg-[#E85A2F]/[0.08]", fg: "text-[#7A2A0E]",  chip: "bg-[#E85A2F] text-[#F2EEE5]" },
      danger:  { bar: "bg-[#9B2C2C]",   bg: "bg-[#9B2C2C]/[0.08]", fg: "text-[#7A1F1F]",  chip: "bg-[#9B2C2C] text-[#F2EEE5]" },
    },
    tabActive: "#E85A2F",
    masthead: "rgba(27,26,23,0.65)",
    bulletLine: "#E85A2F",
  },
  midnight: {
    displayFont: "font-[Fraunces,Georgia,serif]",
    uiFont: "font-grotesk",
    text: "#E8EDF5",
    textMuted: "#8B98B0",
    accent: "#64FFDA",
    accent2: "#A78BFA",
    surface: "#1A2235",
    border: "rgba(255,255,255,0.1)",
    chartPalette: ["#64FFDA", "#A78BFA", "#4A9FD4", "#F59E0B", "#F472B6", "#34D399", "#FB7185"],
    kpiBg: "#1A2235",
    callout: {
      info:    { bar: "bg-[#4A9FD4]",   bg: "bg-[#4A9FD4]/[0.12]", fg: "text-[#E8EDF5]",  chip: "bg-[#4A9FD4] text-[#0F1624]" },
      success: { bar: "bg-[#64FFDA]",   bg: "bg-[#64FFDA]/[0.10]", fg: "text-[#E8EDF5]",  chip: "bg-[#64FFDA] text-[#0F1624]" },
      warning: { bar: "bg-[#F59E0B]",   bg: "bg-[#F59E0B]/[0.10]", fg: "text-[#E8EDF5]",  chip: "bg-[#F59E0B] text-[#0F1624]" },
      danger:  { bar: "bg-[#FB7185]",   bg: "bg-[#FB7185]/[0.10]", fg: "text-[#E8EDF5]",  chip: "bg-[#FB7185] text-[#0F1624]" },
    },
    tabActive: "#64FFDA",
    masthead: "rgba(232,237,245,0.45)",
    bulletLine: "#64FFDA",
  },
  minimal: {
    displayFont: "font-sans",
    uiFont: "font-sans",
    text: "#111111",
    textMuted: "#6B7280",
    accent: "#111111",
    accent2: "#6B7280",
    surface: "#F9FAFB",
    border: "rgba(0,0,0,0.1)",
    chartPalette: ["#111111", "#6B7280", "#D1D5DB", "#374151", "#9CA3AF", "#4B5563", "#1F2937"],
    kpiBg: "#F9FAFB",
    callout: {
      info:    { bar: "bg-gray-800",    bg: "bg-gray-100",          fg: "text-gray-800",    chip: "bg-gray-800 text-white" },
      success: { bar: "bg-green-700",   bg: "bg-green-50",          fg: "text-green-900",   chip: "bg-green-700 text-white" },
      warning: { bar: "bg-amber-500",   bg: "bg-amber-50",          fg: "text-amber-900",   chip: "bg-amber-500 text-white" },
      danger:  { bar: "bg-red-600",     bg: "bg-red-50",            fg: "text-red-900",     chip: "bg-red-600 text-white" },
    },
    tabActive: "#111111",
    masthead: "#6B7280",
    bulletLine: "#111111",
  },
  forest: {
    displayFont: "font-[Fraunces,Georgia,serif]",
    uiFont: "font-grotesk",
    text: "#E8F5EE",
    textMuted: "#7DAF92",
    accent: "#7ECBA1",
    accent2: "#A78BFA",
    surface: "#132318",
    border: "rgba(255,255,255,0.1)",
    chartPalette: ["#7ECBA1", "#A78BFA", "#4A9FD4", "#F59E0B", "#F472B6", "#34D399", "#FB7185"],
    kpiBg: "#132318",
    callout: {
      info:    { bar: "bg-[#4A9FD4]",   bg: "bg-[#4A9FD4]/[0.12]", fg: "text-[#E8F5EE]",  chip: "bg-[#4A9FD4] text-[#0D1F1A]" },
      success: { bar: "bg-[#7ECBA1]",   bg: "bg-[#7ECBA1]/[0.12]", fg: "text-[#E8F5EE]",  chip: "bg-[#7ECBA1] text-[#0D1F1A]" },
      warning: { bar: "bg-[#F59E0B]",   bg: "bg-[#F59E0B]/[0.10]", fg: "text-[#E8F5EE]",  chip: "bg-[#F59E0B] text-[#0D1F1A]" },
      danger:  { bar: "bg-[#FB7185]",   bg: "bg-[#FB7185]/[0.10]", fg: "text-[#E8F5EE]",  chip: "bg-[#FB7185] text-[#0D1F1A]" },
    },
    tabActive: "#7ECBA1",
    masthead: "rgba(232,245,238,0.45)",
    bulletLine: "#7ECBA1",
  },
  slate: {
    displayFont: "font-grotesk",
    uiFont: "font-grotesk",
    text: "#1E293B",
    textMuted: "#64748B",
    accent: "#4F46E5",
    accent2: "#7C3AED",
    surface: "#EEF2FF",
    border: "rgba(30,41,59,0.12)",
    chartPalette: ["#4F46E5", "#7C3AED", "#EC4899", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444"],
    kpiBg: "#EEF2FF",
    callout: {
      info:    { bar: "bg-[#0EA5E9]",   bg: "bg-[#0EA5E9]/[0.08]", fg: "text-[#1E293B]",  chip: "bg-[#0EA5E9] text-white" },
      success: { bar: "bg-[#10B981]",   bg: "bg-[#10B981]/[0.08]", fg: "text-[#1E293B]",  chip: "bg-[#10B981] text-white" },
      warning: { bar: "bg-[#F59E0B]",   bg: "bg-[#F59E0B]/[0.08]", fg: "text-[#1E293B]",  chip: "bg-[#F59E0B] text-white" },
      danger:  { bar: "bg-[#EF4444]",   bg: "bg-[#EF4444]/[0.08]", fg: "text-[#1E293B]",  chip: "bg-[#EF4444] text-white" },
    },
    tabActive: "#4F46E5",
    masthead: "#64748B",
    bulletLine: "#4F46E5",
  },
};

const ThemeCtx = createContext<ThemeTokens>(THEMES.paper);
const useTheme = () => useContext(ThemeCtx);

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useTheme();
  return (
    <div className={cn("text-[10px] uppercase tracking-[0.24em] font-medium", t.uiFont, className)} style={{ color: t.textMuted }}>
      {children}
    </div>
  );
}

function Checklist({ items }: { items: { label: string; checked?: boolean }[] }) {
  const t = useTheme();
  const [state, setState] = useState<boolean[]>(() => items.map((it) => !!it.checked));
  const toggle = (i: number) =>
    setState((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  return (
    <ul className="space-y-3 pl-5" style={{ borderLeft: `2px solid ${t.accent}4D` }}>
      {items.map((it, i) => {
        const checked = state[i];
        return (
          <li key={i} className="flex items-start gap-3 text-[15px]">
            <Checkbox
              id={`pc-${i}-${it.label.slice(0, 16)}`}
              checked={checked}
              onCheckedChange={() => toggle(i)}
              className="mt-[4px]"
              style={{
                borderColor: `${t.text}66`,
                ...(checked ? { backgroundColor: t.accent, borderColor: t.accent } : {}),
              }}
              aria-label={it.label}
            />
            <label
              htmlFor={`pc-${i}-${it.label.slice(0, 16)}`}
              className={cn(
                "text-[17px] leading-relaxed cursor-pointer select-none transition-colors",
                t.displayFont,
                checked ? "line-through italic" : "",
              )}
              style={{ color: checked ? t.textMuted : t.text }}
            >
              {it.label}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Block({ block, index }: { block: PageBlock; index: number }) {
  const t = useTheme();

  switch (block.type) {
    case "heading": {
      if (block.level === 3) {
        return (
          <h3 className={cn("text-[22px] font-normal italic tracking-tight mt-8 mb-1", t.displayFont)} style={{ color: t.text }}>
            {block.text}
          </h3>
        );
      }
      return (
        <div className="mt-12 mb-4">
          <div className="flex items-baseline gap-4 pb-3" style={{ borderBottom: `1px solid ${t.border}` }}>
            <span className={cn("text-[11px] tabular-nums font-semibold tracking-wider", t.uiFont)} style={{ color: t.accent }}>
              §{String(index + 1).padStart(2, "0")}
            </span>
            <h2 className={cn("text-[32px] leading-[1.05] font-normal tracking-tight", t.displayFont)} style={{ color: t.text }}>
              {block.text}
            </h2>
          </div>
        </div>
      );
    }

    case "paragraph":
      return (
        <p className={cn("text-[19px] leading-[1.55] max-w-[62ch]", t.displayFont)} style={{ color: `${t.text}E6` }}>
          {block.text}
        </p>
      );

    case "callout": {
      const tone = block.tone ?? "info";
      const s = t.callout[tone];
      return (
        <div className={cn("relative pl-5 pr-4 py-4 rounded-r-md", s.bg)}>
          <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", s.bar)} />
          {block.title && (
            <div className="mb-1.5">
              <span className={cn("inline-block text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-sm font-semibold", s.chip, t.uiFont)}>
                {block.title}
              </span>
            </div>
          )}
          <div className={cn("text-[16px] leading-[1.55]", s.fg, t.displayFont)}>
            {block.body}
          </div>
        </div>
      );
    }

    case "kpis":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px rounded-md overflow-hidden" style={{ backgroundColor: t.border, border: `1px solid ${t.border}` }}>
          {block.items.map((it, i) => (
            <div key={i} className="px-5 py-5 relative" style={{ backgroundColor: t.kpiBg }}>
              <Eyebrow>{it.label}</Eyebrow>
              <div className={cn("mt-3 text-[40px] leading-[0.95] font-normal tabular-nums", t.displayFont)} style={{ color: t.text }}>
                {it.value}
              </div>
              {it.hint && (
                <div className={cn("mt-2 text-[11px] leading-snug", t.uiFont)} style={{ color: t.textMuted }}>
                  {it.hint}
                </div>
              )}
              <span className="absolute top-3 right-3 h-1 w-1 rounded-full" style={{ backgroundColor: t.accent }} />
            </div>
          ))}
        </div>
      );

    case "checklist":
      return <Checklist items={block.items} />;

    case "bullets":
      return (
        <ul className="space-y-2">
          {block.bullets.map((b, i) => (
            <li key={i} className={cn("flex items-start gap-4 text-[17px] leading-[1.55]", t.displayFont)} style={{ color: `${t.text}E6` }}>
              <span className="mt-[12px] inline-block h-[2px] w-4 flex-shrink-0" style={{ backgroundColor: t.bulletLine }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      );

    case "table":
      return (
        <div className="overflow-hidden" style={{ borderTop: `2px solid ${t.text}CC`, borderBottom: `2px solid ${t.text}CC` }}>
          <table className="w-full text-[14px]">
            <thead>
              <tr style={{ borderBottom: `1px solid ${t.border}`, backgroundColor: `${t.text}0A` }}>
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    className={cn("text-left px-4 py-3 text-[10px] uppercase tracking-[0.2em] font-semibold", t.uiFont)}
                    style={{ color: `${t.text}B3` }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="last:border-b-0 transition-colors" style={{ borderBottom: `1px solid ${t.border}` }}>
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={cn("px-4 py-3 align-top", j === 0 ? cn("text-[16px]", t.displayFont) : cn("text-[13px]", t.uiFont))}
                      style={{ color: j === 0 ? t.text : `${t.text}D9` }}
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
      const tooltipStyle = { background: t.text, border: "none", borderRadius: 6, fontSize: 12, color: t.surface, fontFamily: "Space Grotesk" };
      return (
        <figure className="rounded-md p-6 relative overflow-hidden" style={{ border: `1px solid ${t.border}`, backgroundColor: t.surface }}>
          <span className="absolute top-0 left-0 h-1 w-16" style={{ backgroundColor: t.accent }} />
          {block.title && (
            <figcaption className="mb-5">
              <Eyebrow>Figure {String(index + 1).padStart(2, "0")}</Eyebrow>
              <div className={cn("mt-1 text-[20px] italic", t.displayFont)} style={{ color: t.text }}>
                {block.title}
              </div>
            </figcaption>
          )}
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              {block.chartType === "line" ? (
                <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={t.text} strokeOpacity={0.12} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: t.textMuted, fontFamily: "Space Grotesk" }} axisLine={{ stroke: t.text, strokeOpacity: 0.3 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: t.textMuted, fontFamily: "Space Grotesk" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: t.surface }} cursor={{ stroke: t.accent, strokeWidth: 1, strokeDasharray: "2 2" }} />
                  <Line type="monotone" dataKey="value" stroke={t.accent} strokeWidth={2} dot={{ r: 4, fill: t.accent, strokeWidth: 0 }} activeDot={{ r: 6, fill: t.text, strokeWidth: 2, stroke: t.accent }} />
                </LineChart>
              ) : block.chartType === "pie" ? (
                <PieChart>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} innerRadius={56} paddingAngle={2} stroke={t.surface} strokeWidth={3}>
                    {data.map((_, i) => (<Cell key={i} fill={t.chartPalette[i % t.chartPalette.length]} />))}
                  </Pie>
                </PieChart>
              ) : (
                <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={t.text} strokeOpacity={0.12} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: t.textMuted, fontFamily: "Space Grotesk" }} axisLine={{ stroke: t.text, strokeOpacity: 0.3 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: t.textMuted, fontFamily: "Space Grotesk" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${t.accent}14` }} />
                  <Bar dataKey="value" fill={t.accent} radius={[3, 3, 0, 0]} maxBarSize={56} />
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

function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const theme = useTheme();
  const [active, setActive] = useState(0);
  return (
    <div className="w-full">
      <div className="flex gap-7 mb-10" style={{ borderBottom: `1px solid ${theme.border}` }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={cn("pb-3 pt-0 -mb-px text-[11px] uppercase tracking-[0.22em] font-semibold transition-colors", theme.uiFont)}
            style={{
              color: i === active ? theme.tabActive : `${theme.text}8C`,
              borderBottom: i === active ? `2px solid ${theme.tabActive}` : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <BlockList blocks={tabs[active].blocks} />
    </div>
  );
}

export function PageRenderer({ page }: { page: PageSpec }) {
  const theme = THEMES[page.theme ?? "paper"] ?? THEMES.paper;
  const tabs = page.tabs?.length ? page.tabs : [{ label: "Overview", blocks: [] }];
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase();

  return (
    <ThemeCtx.Provider value={theme}>
      <article className="max-w-[820px] mx-auto px-10 py-12 pb-20">
        {/* Editorial masthead */}
        <header className="mb-12">
          <div className="flex items-center justify-between mb-8 pb-3" style={{ borderBottom: `1px solid ${theme.border}` }}>
            <div className={cn("text-[10px] uppercase tracking-[0.32em] font-semibold", theme.uiFont)} style={{ color: theme.masthead }}>
              The Brief · Vol. 01
            </div>
            <div className={cn("text-[10px] uppercase tracking-[0.32em] tabular-nums font-semibold", theme.uiFont)} style={{ color: theme.masthead }}>
              {today}
            </div>
          </div>
          <div className="flex items-start gap-4">
            <span className="mt-3 inline-block h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: theme.accent }} />
            <div className="flex-1 min-w-0">
              <h1 className={cn("text-[56px] sm:text-[64px] leading-[0.98] font-normal tracking-[-0.015em]", theme.displayFont)} style={{ color: theme.text }}>
                {page.title}
              </h1>
              {page.subtitle && (
                <p className={cn("mt-4 italic text-[22px] leading-[1.4] max-w-[58ch]", theme.displayFont)} style={{ color: `${theme.text}A6` }}>
                  {page.subtitle}
                </p>
              )}
            </div>
          </div>
        </header>

        {tabs.length === 1 ? (
          <BlockList blocks={tabs[0].blocks} />
        ) : (
          <PageTabs tabs={tabs} />
        )}

      </article>
    </ThemeCtx.Provider>
  );
}
