import { PROVIDER_LABEL, modelLabel, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ProviderBadge({ provider, model }: { provider: Provider; model?: string }) {
  const badge = (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <ProviderLogo provider={provider} className="w-4 h-4" />
      <span>{PROVIDER_LABEL[provider]}</span>
    </div>
  );

  if (!model) return badge;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-black text-white border-0 rounded-[4px] px-2 py-1 text-xs shadow-md"
        >
          {modelLabel(model)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
