import { PROVIDER_LABEL, modelLabel, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ModelRef = { provider: Provider; model: string };

export function ProviderBadge({
  provider,
  model,
  modelsUsed,
}: {
  provider: Provider;
  model?: string;
  modelsUsed?: ModelRef[];
}) {
  // De-duplicate modelsUsed by model id, keeping order.
  const allModels: ModelRef[] = (() => {
    if (!modelsUsed || modelsUsed.length === 0) return model ? [{ provider, model }] : [];
    const seen = new Set<string>();
    const out: ModelRef[] = [];
    for (const m of modelsUsed) {
      if (!m || !m.model || seen.has(m.model)) continue;
      seen.add(m.model);
      out.push(m);
    }
    return out;
  })();

  const extra = Math.max(0, allModels.length - 1);
  const primary = allModels[0] ?? { provider, model: model ?? "" };

  const badge = (
    <div className="inline-flex items-center h-6 gap-1.5 rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">
      {/* Stack of provider logos when multiple models */}
      {allModels.length > 1 ? (
        <span className="inline-flex items-center -space-x-1">
          {allModels.slice(0, 3).map((m, i) => (
            <span key={`${m.provider}-${m.model}-${i}`} className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted ring-1 ring-background">
              <ProviderLogo provider={m.provider} className="w-3.5 h-3.5" />
            </span>
          ))}
        </span>
      ) : (
        <ProviderLogo provider={primary.provider} className="w-4 h-4" />
      )}
      <span>{PROVIDER_LABEL[primary.provider]}</span>
      {extra > 0 && (
        <span className="text-muted-foreground/80">+{extra}</span>
      )}
    </div>
  );

  if (allModels.length <= 1) {
    if (!model) return badge;
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{badge}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{modelLabel(model)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Multi-model: hover shows the full list.
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="right" className="p-0">
          <div className="py-1.5 min-w-[180px]">
            <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Models used
            </div>
            {allModels.map((m, i) => (
              <div key={`${m.provider}-${m.model}-${i}`} className="flex items-center gap-2 px-2.5 py-1">
                <ProviderLogo provider={m.provider} className="w-3.5 h-3.5" />
                <span className="text-[12px]">{modelLabel(m.model)}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
