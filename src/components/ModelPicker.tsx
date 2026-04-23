import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <SelectContent className="w-[260px] overflow-visible">
        {PROVIDERS.map((p) =>
          MODELS[p.id].map((m) => (
            <SelectItem key={m.id} value={m.id} className="group/item relative">
              <span className="flex items-center gap-2 leading-none">
                <ProviderLogo provider={p.id} className="w-5 h-5 shrink-0" />
                <span className="leading-none">{m.label}</span>
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap rounded-md bg-black px-2 py-1 text-xs text-white opacity-0 group-hover/item:opacity-100 group-focus/item:opacity-100 data-[highlighted]:opacity-100 transition-opacity z-50"
              >
                {m.description}
              </span>
            </SelectItem>
          )),
        )}
      </SelectContent>
    </Select>
  );
}
