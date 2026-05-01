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
          <div className="rounded-lg border border-border divide-y divide-border bg-background">
            {MODE_DEFS.map((m) => {
              const enabled = !prefs.disabledModes.includes(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3 text-base"
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
          <div className="rounded-lg border border-border divide-y divide-border bg-background">
            {models.map((m) => {
              const isFav = prefs.favoriteModels.includes(m.id);
              const isBlack = prefs.blacklistedModels.includes(m.id);
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-center justify-between px-4 py-3 text-base gap-3",
                    isBlack && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ProviderLogo provider={m.provider} className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate text-base">
                        {m.label}
                      </div>
                      <div className="text-muted-foreground truncate text-sm">
                        {PROVIDER_LABEL[m.provider]}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
                          {isFav ? <Star className="w-4 h-4 fill-current" /> : <Star className="w-4 h-4" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="bg-tooltip text-tooltip-foreground text-xs px-2 py-1 rounded-[4px] border-0">
                        {isFav ? "Remove from favorites" : "Add to favorites"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => toggleBlacklist(m.id)}
                          className={cn(
                            "h-8 w-8 inline-flex items-center justify-center rounded-[4px] transition-colors",
                            isBlack
                              ? "text-destructive hover:bg-dropdown-hover"
                              : "text-muted-foreground hover:bg-dropdown-hover hover:text-foreground",
                          )}
                        >
                          {isBlack ? <Check className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="bg-tooltip text-tooltip-foreground text-xs px-2 py-1 rounded-[4px] border-0">
                        {isBlack ? "Re-enable this model" : "Blacklist this model"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
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
