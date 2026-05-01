import { useMemo } from "react";
import { Star, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAiPreferences } from "@/hooks/useAiPreferences";
import {
  MODE_DEFS,
  RESPONSE_LENGTH_DEFS,
  allModelIds,
  type AiPreferences,
  type ModeId,
  type ResponseLength,
} from "@/lib/aiPreferences";
import { PROVIDER_LABEL } from "@/lib/models";
import { ProviderLogo } from "@/components/ProviderLogo";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AiPersonalizationTab() {
  const { prefs, loading, save } = useAiPreferences();
  const models = allModelIds();

  const update = (patch: Partial<AiPreferences>) => save({ ...prefs, ...patch });

  const toggleMode = (id: ModeId) => {
    const set = new Set(prefs.disabledModes);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ disabledModes: Array.from(set) as ModeId[] });
  };

  const toggleBlacklist = (id: string) => {
    const set = new Set(prefs.blacklistedModels);
    if (set.has(id)) set.delete(id);
    else {
      set.add(id);
      // Remove from favorites if blacklisted
      const favs = prefs.favoriteModels.filter((m) => m !== id);
      update({ blacklistedModels: Array.from(set), favoriteModels: favs });
      return;
    }
    update({ blacklistedModels: Array.from(set) });
  };

  const toggleFavorite = (id: string) => {
    if (prefs.blacklistedModels.includes(id)) return;
    const favs = prefs.favoriteModels.includes(id)
      ? prefs.favoriteModels.filter((m) => m !== id)
      : [...prefs.favoriteModels, id];
    update({ favoriteModels: favs });
  };

  // Group models by provider for the collapsible sections
  const grouped = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return Array.from(map.entries());
  }, [models]);

  // Enable/disable an entire provider at once
  const setProviderEnabled = (provider: string, enabled: boolean) => {
    const ids = models.filter((m) => m.provider === provider).map((m) => m.id);
    const set = new Set(prefs.blacklistedModels);
    if (enabled) {
      ids.forEach((id) => set.delete(id));
      update({ blacklistedModels: Array.from(set) });
    } else {
      ids.forEach((id) => set.add(id));
      const favs = prefs.favoriteModels.filter((m) => !ids.includes(m));
      update({ blacklistedModels: Array.from(set), favoriteModels: favs });
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">Loading preferences…</div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-8 max-w-2xl text-base">
        <header>
          <h2 className="text-lg font-semibold">AI personalization</h2>
          <p className="text-sm text-muted-foreground">
            Choose which modes and models the AI is allowed to use when answering you.
          </p>
        </header>

        {/* ---------- Response length ---------- */}
        <section className="space-y-3">
          <div className="flex items-start justify-between gap-4 text-base">
            <div className="min-w-0">
              <h3 className="font-medium text-base">Response length</h3>
              <p className="text-muted-foreground text-sm">
                Controls how detailed the AI's answers are. Affects every reply.
              </p>
            </div>
            <Select
              value={prefs.responseLength}
              onValueChange={(v) => update({ responseLength: v as ResponseLength })}
            >
              <SelectTrigger className="w-44 shrink-0 text-base">
                <SelectValue>
                  {RESPONSE_LENGTH_DEFS.find((o) => o.id === prefs.responseLength)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RESPONSE_LENGTH_DEFS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    <div className="flex flex-col">
                      <span className="font-medium text-base">{opt.label}</span>
                      <span className="text-muted-foreground text-sm">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {/* ---------- Modes ---------- */}
        <section className="space-y-3">
          <div>
            <h3 className="font-medium text-base">Modes</h3>
            <p className="text-muted-foreground text-sm">
              Disabled modes are hidden from the slash menu and never auto-triggered.
            </p>
          </div>
          <div className="space-y-1">
            {MODE_DEFS.map((m) => {
              const enabled = !prefs.disabledModes.includes(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between py-2 text-base gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-base">{m.label}</div>
                    <div className="text-muted-foreground text-sm">{m.description}</div>
                  </div>
                  <Switch checked={enabled} onCheckedChange={() => toggleMode(m.id)} />
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Models ---------- */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h3 className="font-medium text-base">Models</h3>
              <p className="text-muted-foreground text-sm">
                Star your favorites (used first in Auto mode) or blacklist models you never want to use.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {grouped.map(([provider, providerModels]) => {
              const ids = providerModels.map((m) => m.id);
              const enabledCount = ids.filter((id) => !prefs.blacklistedModels.includes(id)).length;
              const anyEnabled = enabledCount > 0;
              return (
                <Collapsible key={provider} className="rounded-lg border border-border bg-background">
                  <div className="flex items-center justify-between px-4 py-3 gap-3">
                    <CollapsibleTrigger className="group flex items-center gap-2 min-w-0 flex-1 text-left">
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90 shrink-0" />
                      <ProviderLogo provider={provider as any} className="w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate text-base">
                          {(PROVIDER_LABEL as any)[provider] ?? provider}
                        </div>
                        <div className="text-muted-foreground truncate text-sm">
                          {enabledCount} / {ids.length} enabled
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <Switch
                      checked={anyEnabled}
                      onCheckedChange={(v) => setProviderEnabled(provider, v)}
                    />
                  </div>
                  <CollapsibleContent>
                    <div className="border-t border-border divide-y divide-border">
                      {providerModels.map((m) => {
                        const isFav = prefs.favoriteModels.includes(m.id);
                        const isBlack = prefs.blacklistedModels.includes(m.id);
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "flex items-center justify-between px-4 py-2.5 text-base gap-3 pl-10",
                              isBlack && "opacity-60",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate text-base">
                                {m.label}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => toggleFavorite(m.id)}
                                    disabled={isBlack}
                                    className={cn(
                                      "h-8 w-8 inline-flex items-center justify-center rounded-[4px] transition-colors",
                                      isFav
                                        ? "text-amber-500 hover:bg-dropdown-hover"
                                        : "text-muted-foreground hover:bg-dropdown-hover hover:text-foreground",
                                      isBlack && "cursor-not-allowed opacity-50",
                                    )}
                                  >
                                    <Star className={cn("w-4 h-4", isFav && "fill-current")} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="bg-tooltip text-tooltip-foreground text-xs px-2 py-1 rounded-[4px] border-0">
                                  {isFav ? "Remove from favorites" : "Add to favorites"}
                                </TooltipContent>
                              </Tooltip>
                              <Switch
                                checked={!isBlack}
                                onCheckedChange={() => toggleBlacklist(m.id)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
          {prefs.favoriteModels.length > 0 && (
            <p className="text-muted-foreground text-sm">
              <span className="font-medium text-foreground">Priority order:</span>{" "}
              {prefs.favoriteModels.join(" › ")}
            </p>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}
