// Editorial renderer for AI-generated one-pagers.
// Visual language: serif display titles (Fraunces), tabular figures for KPIs,
// generous whitespace, restrained accent color, mono eyebrows.
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

// Editorial palette — quiet, with one warm accent.
const ACCENT = "#B45309"; // burnt amber
const INK = "#1A1A1A";
const SOFT = "#6B6B6B";

const CHART_PALETTE = [
  ACCENT,
  "#1A1A1A",
  "#9A8C7A",
  "#C9A063",
  "#5A6B5C",
  "#7A4A2B",
  "#A89684",
];

const calloutStyles: Record<string, string> = {
  info: "border-l-2 border-[#1A1A1A]/60 bg-[#FAFAF7]",
  success: "border-l-2 border-[#5A6B5C] bg-[#F4F6F1]",
  warning: "border-l-2 border-[#B45309] bg-[#FBF5EC]",
  danger: "border-l-2 border-[#9B2C2C] bg-[#FBF1F1]",
};

const calloutText: Record<string, string> = {
  info: "text-[#1A1A1A]",
  success: "text-[#3F4F40]",
  warning: "text-[#7A4A09]",
  danger: "text-[#7A1F1F]",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6B6B6B]">
      {children}
    </div>
  );
}

function Block({ block, index }: { block: PageBlock; index: number }) {
  switch (block.type) {
    case "heading": {
      if (block.level === 3) {
        return (
          <h3 className="font-serif text-[17px] font-medium tracking-tight text-[#1A1A1A] mt-6 mb-1">
            {block.text}
          </h3>
        );
      }
      return (
        <div className="mt-10 mb-3 flex items-baseline gap-3">
          <span className="font-mono text-[10px] tabular-nums text-[#B45309]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2 className="font-serif text-[24px] leading-tight font-medium tracking-tight text-[#1A1A1A]">
            {block.text}
          </h2>
        </div>
      );
    }

    case "paragraph":
      return (
        <p className="font-serif text-[15px] leading-[1.7] text-[#1A1A1A]/85 max-w-[68ch]">
          {block.text}
        </p>
      );

    case "callout": {
      const tone = block.tone ?? "info";
      return (
        <div
          className={cn(
            "pl-4 pr-3 py-3 rounded-r-sm",
            calloutStyles[tone],
          )}
        >
          {block.title && (
            <div
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.18em] mb-1",
                calloutText[tone],
              )}
            >
              {block.title}
            </div>
          )}
          <div className={cn("font-serif text-[14px] leading-relaxed", calloutText[tone])}>
            {block.body}
          </div>
        </div>
      );
    }

    case "kpis":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-border rounded-sm overflow-hidden border border-border">
          {block.items.map((it, i) => (
            <div key={i} className="bg-background px-4 py-4">
              <Eyebrow>{it.label}</Eyebrow>
              <div className="mt-2 font-serif text-[28px] leading-none font-medium text-[#1A1A1A] tabular-nums">
                {it.value}
              </div>
              {it.hint && (
                <div className="mt-1.5 text-[12px] text-[#6B6B6B] leading-snug">
                  {it.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    case "checklist":
      return (
        <ul className="space-y-2.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 text-[14px]">
              <Checkbox
                checked={!!it.checked}
                className="mt-[3px]"
                aria-label={it.label}
              />
              <span
                className={cn(
                  "font-serif leading-relaxed",
                  it.checked ? "text-[#6B6B6B] line-through" : "text-[#1A1A1A]",
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
        <ul className="space-y-1.5">
          {block.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 font-serif text-[14px] leading-relaxed text-[#1A1A1A]/90">
              <span className="mt-[10px] inline-block h-px w-3 bg-[#B45309] flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      );

    case "table":
      return (
        <div className="overflow-hidden border-y border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6B6B6B]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-3 py-2.5 align-top text-[#1A1A1A]/90",
                        j === 0 ? "font-serif font-medium text-[#1A1A1A]" : "font-sans",
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
        <figure className="border border-border rounded-sm bg-background p-5">
          {block.title && (
            <figcaption className="mb-4">
              <Eyebrow>Figure</Eyebrow>
              <div className="mt-1 font-serif text-[15px] text-[#1A1A1A]">
                {block.title}
              </div>
            </figcaption>
          )}
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              {block.chartType === "line" ? (
                <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#E0E0E0" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: SOFT, fontFamily: "JetBrains Mono" }}
                    axisLine={{ stroke: "#E0E0E0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: SOFT, fontFamily: "JetBrains Mono" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: INK,
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "#fff",
                    }}
                    labelStyle={{ color: "#fff" }}
                    cursor={{ stroke: ACCENT, strokeWidth: 1, strokeDasharray: "2 2" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: ACCENT, strokeWidth: 0 }}
                  />
                </LineChart>
              ) : block.chartType === "pie" ? (
                <PieChart>
                  <Tooltip
                    contentStyle={{
                      background: INK,
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "#fff",
                    }}
                  />
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={92}
                    innerRadius={48}
                    paddingAngle={1}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                </PieChart>
              ) : (
                <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#E0E0E0" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: SOFT, fontFamily: "JetBrains Mono" }}
                    axisLine={{ stroke: "#E0E0E0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: SOFT, fontFamily: "JetBrains Mono" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: INK,
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "#fff",
                    }}
                    cursor={{ fill: "rgba(180,83,9,0.06)" }}
                  />
                  <Bar dataKey="value" fill={ACCENT} radius={[2, 2, 0, 0]} maxBarSize={48} />
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
    <div className="space-y-5">
      {blocks.map((b, i) => {
        if (b.type === "heading" && (b.level ?? 2) === 2) headingIndex += 1;
        return <Block key={i} block={b} index={headingIndex} />;
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
  });

  return (
    <article className="max-w-[780px] mx-auto pb-16">
      {/* Editorial masthead */}
      <header className="border-b border-[#1A1A1A] pb-6 mb-10">
        <div className="flex items-center justify-between mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6B6B6B]">
            Lovable · One-pager
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6B6B6B] tabular-nums">
            {today}
          </div>
        </div>
        <h1 className="font-serif text-[40px] leading-[1.05] font-medium tracking-tight text-[#1A1A1A]">
          {page.title}
        </h1>
        {page.subtitle && (
          <p className="mt-3 font-serif italic text-[16px] leading-relaxed text-[#6B6B6B] max-w-[60ch]">
            {page.subtitle}
          </p>
        )}
      </header>

      {tabs.length === 1 ? (
        <BlockList blocks={tabs[0].blocks} />
      ) : (
        <Tabs defaultValue="0" className="w-full">
          <TabsList className="bg-transparent p-0 h-auto gap-6 border-b border-border rounded-none w-full justify-start mb-8">
            {tabs.map((t, i) => (
              <TabsTrigger
                key={i}
                value={String(i)}
                className={cn(
                  "rounded-none bg-transparent px-0 pb-3 pt-0 -mb-px",
                  "font-mono text-[11px] uppercase tracking-[0.16em] text-[#6B6B6B]",
                  "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  "data-[state=active]:text-[#1A1A1A] data-[state=active]:border-b-2 data-[state=active]:border-[#B45309]",
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
      <footer className="mt-16 pt-6 border-t border-border flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6B6B6B]">
          End of document
        </div>
        <div className="h-1.5 w-1.5 rounded-full bg-[#B45309]" />
      </footer>
    </article>
  );
}
