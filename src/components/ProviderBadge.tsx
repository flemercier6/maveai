import { PROVIDER_LABEL, modelLabel, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ProviderBadge({ provider, model }: { provider: Provider; model?: string }) {
  const badge = (
    <div className="inline-flex items-center h-6 gap-1.5 rounded-full border border-border bg-[#f8f8f8] px-2 text-[11px] font-medium text-muted-foreground">
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
        <TooltipContent side="right">{modelLabel(model)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
