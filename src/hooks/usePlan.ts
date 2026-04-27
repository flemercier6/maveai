// Plan + free-tier limits.
//
// A user is "free" unless their billing_accounts.plan is anything other than
// "free" (e.g. "plus"). We treat the absence of a row as "free".
//
// Free limits (kept in sync with the chat edge function):
//  - 5 chat requests / day (UTC)
//  - no memory injection or creation
//  - no folders / no chat persistence (every conversation is ephemeral)
//  - blocked premium models: gpt-5.5, claude-opus-4-7, gemini-2.5-pro,
//    mistral-large-latest

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const FREE_DAILY_LIMIT = 5;

export const PREMIUM_MODELS = new Set<string>([
  "gpt-5.5",
  "claude-opus-4-7",
  "gemini-2.5-pro",
  "mistral-large-latest",
]);

export function isPremiumModel(modelId: string): boolean {
  return PREMIUM_MODELS.has(modelId);
}

export type PlanState = {
  plan: string;
  isFree: boolean;
  loading: boolean;
  todayCount: number;
  remaining: number;
  refresh: () => Promise<void>;
};

export function usePlan(): PlanState {
  const { user } = useAuth();
  const [plan, setPlan] = useState<string>("free");
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setPlan("free");
      setTodayCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: planData }, { data: countData }] = await Promise.all([
      supabase.rpc("get_user_plan", { _user_id: user.id }),
      supabase.rpc("count_today_requests", { _user_id: user.id }),
    ]);
    setPlan(typeof planData === "string" ? planData : "free");
    setTodayCount(typeof countData === "number" ? countData : 0);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isFree = plan === "free";
  const remaining = isFree ? Math.max(0, FREE_DAILY_LIMIT - todayCount) : Infinity;

  return { plan, isFree, loading, todayCount, remaining, refresh };
}
