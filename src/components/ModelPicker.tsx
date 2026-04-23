import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODELS, PROVIDERS, PROVIDER_LABEL, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ provider, model, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={provider}
        onValueChange={(v) => {
          const p = v as Provider;
          onChange(p, MODELS[p][0].id);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-[160px] h-9 bg-card">
          <SelectValue>
            <span className="inline-flex items-center gap-2">
              <ProviderLogo provider={provider} className="w-3.5 h-3.5" />
              {PROVIDER_LABEL[provider]}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="inline-flex items-center gap-2">
                <ProviderLogo provider={p.id} className="w-3.5 h-3.5" />
                {PROVIDER_LABEL[p.id]}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={model} onValueChange={(v) => onChange(provider, v)} disabled={disabled}>
        <SelectTrigger className="w-[220px] h-9 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELS[provider].map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
