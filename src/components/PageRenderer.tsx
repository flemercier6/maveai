// Types + renderer for the AI-generated one-pager.
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

const CHART_COLORS = [
  "hsl(var(--primary))",
  "#0062FF",
  "#7C3AED",
  "#EC4899",
  "#10B981",
  "#F59E0B",
  "#EF4444",
];

const calloutStyles: Record<string, string> = {
  info: "bg-[#EFF6FF] text-[#0062FF] border-[#DBEAFE]",
  success: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
  warning: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  danger: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
};

function Block({ block }: { block: PageBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = block.level === 3 ? "h3" : "h2";
      return (
        <Tag
          className={cn(
            "font-semibold tracking-tight text-foreground",
            block.level === 3 ? "text-base mt-4 mb-1" : "text-xl mt-6 mb-2",
          )}
        >
          {block.text}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="text-sm leading-relaxed text-foreground/90">{block.text}</p>
      );
    case "callout": {
      const tone = block.tone ?? "info";
      return (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            calloutStyles[tone],
          )}
        >
          {block.title && (
            <div className="font-semibold mb-0.5">{block.title}</div>
          )}
          <div className="opacity-90">{block.body}</div>
        </div>
      );
    }
    case "kpis":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {block.items.map((it, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {it.label}
              </div>
              <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">
                {it.value}
              </div>
              {it.hint && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {it.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    case "checklist":
      return (
        <ul className="space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={!!it.checked}
                className="mt-0.5"
                aria-label={it.label}
              />
              <span className="text-foreground/90">{it.label}</span>
            </li>
          ))}
        </ul>
      );
    case "bullets":
      return (
        <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/90">
          {block.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((cell, j) => (
                    <td key={j} className="px-3 py-2 text-foreground/90">
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
        <div className="rounded-lg border border-border bg-card p-4">
          {block.title && (
            <div className="text-sm font-medium mb-3 text-foreground">
              {block.title}
            </div>
          )}
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              {block.chartType === "line" ? (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={CHART_COLORS[1]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              ) : block.chartType === "pie" ? (
                <PieChart>
                  <Tooltip />
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label
                  >
                    {data.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              ) : (
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

export function PageRenderer({ page }: { page: PageSpec }) {
  const tabs = page.tabs?.length ? page.tabs : [{ label: "Overview", blocks: [] }];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {page.title}
        </h1>
        {page.subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{page.subtitle}</p>
        )}
      </header>
      {tabs.length === 1 ? (
        <div className="space-y-4">
          {tabs[0].blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>
      ) : (
        <Tabs defaultValue="0" className="w-full">
          <TabsList className="bg-muted/50">
            {tabs.map((t, i) => (
              <TabsTrigger key={i} value={String(i)}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t, i) => (
            <TabsContent key={i} value={String(i)} className="space-y-4 pt-4">
              {t.blocks.map((b, j) => (
                <Block key={j} block={b} />
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
