import { Star, X as Ban, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
      <div className="space-y-8 max-w-2xl">
        <header>
          <h2 className="text-lg font-semibold">AI personalization</h2>
          <p className="text-sm text-muted-foreground">
            Choose which modes and models the AI is allowed to use when answering you.
          </p>
        </header>

        {/* ---------- Modes ---------- */}
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Modes</h3>
            <p className="text-xs text-muted-foreground">
              Disabled modes are hidden from the slash menu and never auto-triggered.
            </p>
          </div>
          <div className="rounded-lg border border-border divide-y divide-border bg-background">
            {MODE_DEFS.map((m) => {
              const enabled = !prefs.disabledModes.includes(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.description}</div>
                  </div>
                  <Switch checked={enabled} onCheckedChange={() => toggleMode(m.id)} />
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Response length ---------- */}
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Response length</h3>
            <p className="text-xs text-muted-foreground">
              Controls how detailed the AI's answers are. Affects every reply.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {RESPONSE_LENGTH_DEFS.map((opt) => {
              const active = prefs.responseLength === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => update({ responseLength: opt.id as ResponseLength })}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-foreground bg-foreground/[0.04]"
                      : "border-border bg-background hover:bg-dropdown-hover",
                  )}
                >
                  <div className="text-sm font-medium text-foreground">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.description}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------- Models ---------- */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h3 className="text-sm font-medium">Models</h3>
              <p className="text-xs text-muted-foreground">
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
                    "flex items-center justify-between px-4 py-3 gap-3",
                    isBlack && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ProviderLogo provider={m.provider} className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {m.label}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
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
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Priority order:</span>{" "}
              {prefs.favoriteModels.join(" › ")}
            </p>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}
