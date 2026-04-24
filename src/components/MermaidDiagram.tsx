import { memo, useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "default",
    fontFamily: "inherit",
  });
}

type Props = { code: string };

function MermaidDiagramImpl({ code }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reactId = useId();
  const renderId = "mmd-" + reactId.replace(/[^a-zA-Z0-9]/g, "");
  const lastCodeRef = useRef<string>("");

  useEffect(() => {
    ensureInit();
    const trimmed = code.trim();
    if (!trimmed || trimmed === lastCodeRef.current) return;
    lastCodeRef.current = trimmed;

    let cancelled = false;
    (async () => {
      try {
        const { svg } = await mermaid.render(renderId, trimmed);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render diagram");
          setSvg(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-border bg-muted/40 p-3 overflow-x-auto">
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
          Diagram (raw)
        </div>
        <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="my-4 rounded-lg border border-border bg-card p-3 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export const MermaidDiagram = memo(MermaidDiagramImpl, (a, b) => a.code === b.code);
