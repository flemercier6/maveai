import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODELS, PROVIDERS, PROVIDER_LABEL, type Provider } from "@/lib/models";

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
        <SelectTrigger className="w-[140px] h-9 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id}>{PROVIDER_LABEL[p.id]}</SelectItem>
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
