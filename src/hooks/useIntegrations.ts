import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Integration = {
  id: string;
  provider: string;
  account_email: string | null;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
};

export function useIntegrations() {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setIntegrations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("user_integrations")
      .select("id, provider, account_email, scopes, expires_at, created_at")
      .eq("user_id", user.id);
    if (!error && data) setIntegrations(data as Integration[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when the popup window closes (user came back from Google).
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const isConnected = (provider: string) =>
    integrations.some((i) => i.provider === provider);

  return { integrations, loading, isConnected, refresh };
}
