import { memo, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { SkeletonShimmer } from "./SkeletonShimmer";

type RawNode = {
  id: string;
  label: string;
  kind?: "default" | "input" | "output" | "decision" | "success" | "warning" | "danger" | "muted";
};
type RawEdge = {
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  dashed?: boolean;
};
type Spec = {
  direction?: "LR" | "TB" | "RL" | "BT";
  nodes: RawNode[];
  edges: RawEdge[];
  title?: string;
};

type Props = { code: string };

// ---------- Custom node ----------
const KIND_STYLES: Record<NonNullable<RawNode["kind"]>, { bg: string; border: string; text: string }> = {
  default: { bg: "hsl(var(--card))", border: "hsl(var(--border))", text: "hsl(var(--foreground))" },
  input: { bg: "hsl(var(--primary))", border: "hsl(var(--primary))", text: "hsl(var(--primary-foreground))" },
  output: { bg: "hsl(var(--foreground))", border: "hsl(var(--foreground))", text: "hsl(var(--background))" },
  decision: { bg: "hsl(var(--muted))", border: "hsl(var(--border))", text: "hsl(var(--foreground))" },
  success: { bg: "hsl(142 70% 45%)", border: "hsl(142 70% 38%)", text: "white" },
  warning: { bg: "hsl(38 95% 55%)", border: "hsl(38 95% 48%)", text: "white" },
  danger: { bg: "hsl(0 75% 55%)", border: "hsl(0 75% 48%)", text: "white" },
  muted: { bg: "hsl(var(--muted))", border: "hsl(var(--border))", text: "hsl(var(--muted-foreground))" },
};

type FlowNodeData = { label: string; kind: NonNullable<RawNode["kind"]>; isDecision: boolean };

const FlowNode = memo(({ data, sourcePosition, targetPosition }: NodeProps<Node<FlowNodeData>>) => {
  const s = KIND_STYLES[data.kind] ?? KIND_STYLES.default;
  const shape = data.isDecision
    ? "rounded-md rotate-0"
    : data.kind === "input" || data.kind === "output"
      ? "rounded-full"
      : "rounded-xl";
  return (
    <div
      className={`px-3.5 py-2 text-xs font-medium border shadow-sm ${shape} max-w-[220px] text-center break-words leading-snug`}
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      <Handle type="target" position={targetPosition ?? Position.Top} style={{ opacity: 0 }} />
      {data.label}
      <Handle type="source" position={sourcePosition ?? Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});
FlowNode.displayName = "FlowNode";

const NODE_TYPES = { flow: FlowNode };

// ---------- Layout ----------
function layout(spec: Spec): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const direction = spec.direction ?? "TB";
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 70, marginx: 10, marginy: 10 });

  const NODE_W = 180;
  const NODE_H = 56;
  spec.nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  spec.edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const isHorizontal = direction === "LR" || direction === "RL";
  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom;
  const targetPosition = isHorizontal ? Position.Left : Position.Top;

  const nodes: Node<FlowNodeData>[] = spec.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "flow",
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: { label: n.label, kind: n.kind ?? "default", isDecision: n.kind === "decision" },
      sourcePosition,
      targetPosition,
    };
  });

  const edges: Edge[] = spec.edges.map((e, i) => ({
    id: `e${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: !!e.animated,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--foreground))" },
    style: {
      stroke: "hsl(var(--foreground))",
      strokeWidth: 1.5,
      strokeDasharray: e.dashed ? "4 4" : undefined,
    },
    labelStyle: { fill: "hsl(var(--foreground))", fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: "hsl(var(--background))" },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  }));

  return { nodes, edges };
}

// ---------- Parsing ----------
function parseSpec(code: string): Spec | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed as Spec;
  } catch {
    return null;
  }
}

function FlowDiagramImpl({ code }: Props) {
  const spec = useMemo(() => parseSpec(code), [code]);
  const layouted = useMemo(() => (spec ? layout(spec) : null), [spec]);

  if (!spec) {
    // Likely still streaming — show shimmer skeleton.
    return (
      <div className="my-4 rounded-lg border border-border bg-card p-4 space-y-2">
        <SkeletonShimmer className="h-4 w-1/3" />
        <SkeletonShimmer className="h-40 w-full" />
        <div className="flex gap-2">
          <SkeletonShimmer className="h-3 w-20" />
          <SkeletonShimmer className="h-3 w-32" />
        </div>
      </div>
    );
  }

  const nodeCount = spec.nodes.length;
  const height = Math.min(560, Math.max(220, 80 + nodeCount * 60));

  return (
    <div className="my-4 rounded-lg border border-border bg-card overflow-hidden">
      {spec.title && (
        <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
          {spec.title}
        </div>
      )}
      <div style={{ height }} className="w-full">
        <ReactFlow
          nodes={layouted!.nodes}
          edges={layouted!.edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
        >
          <Background gap={20} size={1} color="hsl(var(--border))" />
          <Controls showInteractive={false} className="!bg-card !border !border-border" />
        </ReactFlow>
      </div>
    </div>
  );
}

export const FlowDiagram = memo(FlowDiagramImpl, (a, b) => a.code === b.code);
