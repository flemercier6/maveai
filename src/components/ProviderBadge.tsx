import { PROVIDER_LABEL, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";

export function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <ProviderLogo provider={provider} className="w-3.5 h-3.5" />
      <span>{PROVIDER_LABEL[provider]}</span>
    </div>
  );
}
