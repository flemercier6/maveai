import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_AI_PREFS,
  type AiPreferences,
  type ModeId,
} from "@/lib/aiPreferences";

type Row = {
  user_id: string;
  disabled_modes: string[] | null;
  blacklisted_models: string[] | null;
  favorite_models: string[] | null;
};

const rowToPrefs = (row: Row | null | undefined): AiPreferences => ({
  disabledModes: ((row?.disabled_modes ?? []) as ModeId[]).filter(Boolean),
  blacklistedModels: (row?.blacklisted_models ?? []).filter(Boolean),
  favoriteModels: (row?.favorite_models ?? []).filter(Boolean),
});

export function useAiPreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AiPreferences>(DEFAULT_AI_PREFS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setPrefs(DEFAULT_AI_PREFS);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("ai_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    setPrefs(rowToPrefs(data as Row | null));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cross-tab/cross-component sync
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("ai-prefs-updated", handler);
    return () => window.removeEventListener("ai-prefs-updated", handler);
  }, [refresh]);

  const save = useCallback(
    async (next: AiPreferences) => {
      if (!user) return;
      setPrefs(next); // optimistic
      const { error } = await supabase.from("ai_preferences").upsert({
        user_id: user.id,
        disabled_modes: next.disabledModes,
        blacklisted_models: next.blacklistedModels,
        favorite_models: next.favoriteModels,
      });
      if (error) console.error("[ai-prefs] save error:", error);
      window.dispatchEvent(new CustomEvent("ai-prefs-updated"));
    },
    [user],
  );

  return { prefs, loading, save, refresh };
}
