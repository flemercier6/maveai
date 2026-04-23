import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MODELS, PROVIDERS, type Provider, providerForModel } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ provider, model, onChange, disabled }: Props) {
  const currentModel = MODELS[provider].find((m) => m.id === model);

  return (
    <TooltipProvider delayDuration={200}>
      <Select
        value={model}
        onValueChange={(v) => {
          const p = providerForModel(v);
          onChange(p, v);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-[220px] h-9 bg-card">
          <SelectValue>
            <span className="flex items-center gap-2 leading-none">
              <ProviderLogo provider={provider} className="w-5 h-5 shrink-0" />
              <span className="leading-none">{currentModel?.label ?? model}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[260px]">
          {PROVIDERS.map((p) =>
            MODELS[p.id].map((m) => (
              <Tooltip key={m.id}>
                <TooltipTrigger asChild>
                  <SelectItem value={m.id}>
                    <span className="flex items-center gap-2 leading-none">
                      <ProviderLogo provider={p.id} className="w-5 h-5 shrink-0" />
                      <span className="leading-none">{m.label}</span>
                    </span>
                  </SelectItem>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="bg-black text-white border-black text-xs px-2 py-1"
                >
                  {m.description}
                </TooltipContent>
              </Tooltip>
            )),
          )}
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
}
