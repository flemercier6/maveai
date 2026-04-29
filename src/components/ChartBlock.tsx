// Renders a fenced ```chart block (JSON spec) as a recharts visualization.
// Supported types: bar, line, area, pie.
import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { SkeletonShimmer } from "./SkeletonShimmer";

type ChartType = "bar" | "line" | "area" | "pie";
type Spec = {
  type: ChartType;
  title?: string;
  xKey?: string;        // key in each data point used as the category/x axis (default "name")
  series?: { key: string; label?: string; color?: string }[]; // for bar/line/area
  data: Record<string, any>[];
  stacked?: boolean;
  unit?: string;        // suffix on y-axis ticks/tooltip ("%", "€", "k"...)
};

type Props = { code: string };

// Palette aligned with the design system (HSL via CSS vars where possible).
const PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--foreground))",
  "hsl(217 91% 60%)",
  "hsl(142 70% 45%)",
  "hsl(38 95% 55%)",
  "hsl(280 70% 60%)",
  "hsl(0 75% 60%)",
  "hsl(190 80% 45%)",
];

function parseSpec(code: string): Spec | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    if (!parsed || !parsed.type || !Array.isArray(parsed.data)) return null;
    if (!["bar", "line", "area", "pie"].includes(parsed.type)) return null;
    return parsed as Spec;
  } catch {
    return null;
  }
}

const tickStyle = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const gridStroke = "hsl(var(--border))";

function ChartBlockImpl({ code }: Props) {
  const spec = useMemo(() => parseSpec(code), [code]);

  if (!spec) {
    return (
      <div className="my-4 rounded-lg border border-border bg-card p-4 space-y-2">
        <SkeletonShimmer className="h-4 w-1/3" />
        <SkeletonShimmer className="h-48 w-full" />
      </div>
    );
  }

  const xKey = spec.xKey ?? "name";
  const series = (spec.series && spec.series.length
    ? spec.series
    : Object.keys(spec.data[0] ?? {})
        .filter((k) => k !== xKey)
        .map((k) => ({ key: k }))
  ).map((s, i) => ({ ...s, color: s.color ?? PALETTE[i % PALETTE.length] }));

  const unit = spec.unit ?? "";
  const tooltipFormatter = (v: any) =>
    typeof v === "number" ? `${v.toLocaleString()}${unit}` : v;
  const yTickFormatter = (v: any) =>
    typeof v === "number" ? `${v}${unit}` : v;

  const height = 260;

  const renderInner = () => {
    if (spec.type === "pie") {
      const dataKey = series[0]?.key ?? "value";
      return (
        <PieChart>
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Pie
            data={spec.data}
            dataKey={dataKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={90}
            innerRadius={45}
            paddingAngle={2}
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="hsl(var(--background))" strokeWidth={2} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    const Common = (
      <>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={tickStyle} stroke={gridStroke} tickLine={false} axisLine={{ stroke: gridStroke }} />
        <YAxis tick={tickStyle} stroke={gridStroke} tickLine={false} axisLine={{ stroke: gridStroke }} tickFormatter={yTickFormatter} width={40} />
        <Tooltip
          formatter={tooltipFormatter}
          contentStyle={{
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </>
    );

    if (spec.type === "bar") {
      return (
        <BarChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {Common}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={s.color} radius={[4, 4, 0, 0]} stackId={spec.stacked ? "a" : undefined} />
          ))}
        </BarChart>
      );
    }

    if (spec.type === "area") {
      return (
        <AreaChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {Common}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={s.color} fill={s.color} fillOpacity={0.18} strokeWidth={2} stackId={spec.stacked ? "a" : undefined} />
          ))}
        </AreaChart>
      );
    }

    // line
    return (
      <LineChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {Common}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    );
  };

  return (
    <div className="my-4 rounded-lg border border-border bg-card overflow-hidden">
      {spec.title && (
        <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
          {spec.title}
        </div>
      )}
      <div style={{ height }} className="w-full p-2">
        <ResponsiveContainer width="100%" height="100%">
          {renderInner()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const ChartBlock = memo(ChartBlockImpl, (a, b) => a.code === b.code);
