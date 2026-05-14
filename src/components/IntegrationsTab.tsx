import { useState } from "react";
import { Mail, Calendar, HardDrive, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIntegrations } from "@/hooks/useIntegrations";
import { cn } from "@/lib/utils";
import { getOAuthReturnUri, shouldUseFullPageOAuthRedirect } from "@/lib/oauthRedirect";
import geminiLogo from "@/assets/gemini-logo.png";
import voyagerLogo from "@/assets/logo-voyager.png";

export function IntegrationsTab() {
  const { integrations, loading, isConnected, refresh } = useIntegrations();
  const [busy, setBusy] = useState<string | null>(null);
  const [voyagerKey, setVoyagerKey] = useState("");

  const googleConnected = isConnected("google");
  const googleAccount = integrations.find((i) => i.provider === "google");
  const voyagerConnected = isConnected("voyager");

  const connectGoogle = async () => {
    setBusy("google");
    try {
      const { data, error } = await supabase.functions.invoke(
        "google-oauth-start",
        { body: { return_to: getOAuthReturnUri() } },
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("No OAuth URL returned");
      if (shouldUseFullPageOAuthRedirect()) {
        window.location.href = url;
        return;
      }
      const popup = window.open(url, "google-oauth", "width=520,height=640");
      if (!popup) window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect Google");
    } finally {
      setBusy(null);
    }
  };

  const disconnectGoogle = async () => {
    setBusy("google");
    try {
      const { error } = await supabase.functions.invoke("google-oauth-disconnect");
      if (error) throw error;
      toast.success("Google disconnected");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect Google");
    } finally {
      setBusy(null);
    }
  };

  const connectVoyager = async () => {
    const key = voyagerKey.trim();
    if (!key.startsWith("vyg_")) {
      toast.error("API key must start with vyg_");
      return;
    }
    setBusy("voyager");
    try {
      const { data, error } = await supabase.functions.invoke("voyager-crm", {
        body: { action: "connect", apiKey: key },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "Could not connect Voyager");
      toast.success("Voyager CRM connected");
      setVoyagerKey("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect Voyager");
    } finally {
      setBusy(null);
    }
  };

  const disconnectVoyager = async () => {
    setBusy("voyager");
    try {
      const { error } = await supabase.functions.invoke("voyager-crm", {
        body: { action: "disconnect" },
      });
      if (error) throw error;
      toast.success("Voyager CRM disconnected");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect Voyager");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-6 max-w-3xl">
      <header>
        <h2 className="font-semibold text-lg">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect external services so the AI can act on your behalf.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Google */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={geminiLogo}
                alt="Google"
                className="w-10 h-10 rounded-lg object-contain shrink-0"
              />
              <div className="min-w-0">
                <div className="font-medium text-foreground text-base">Google</div>
                {googleConnected && googleAccount?.account_email ? (
                  <div className="text-muted-foreground text-sm truncate">
                    {googleAccount.account_email}
                  </div>
                ) : null}
              </div>
            </div>
            {googleConnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-sm text-foreground/80 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(140_70%_42%)]" />
                Synced
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Connect Gmail, Calendar and Drive so the AI can read and draft emails,
            manage events and pull files.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { icon: Mail, label: "Gmail" },
              { icon: Calendar, label: "Calendar" },
              { icon: HardDrive, label: "Drive" },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <span
                  key={f.label}
                  className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-sm text-foreground/70"
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </span>
              );
            })}
          </div>
          <div className="mt-auto pt-1">
            {googleConnected ? (
              <button
                type="button"
                disabled={busy === "google" || loading}
                onClick={disconnectGoogle}
                className={cn(
                  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-dropdown-hover transition-colors",
                  (busy === "google" || loading) && "opacity-60 cursor-not-allowed",
                )}
              >
                {busy === "google" ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy === "google" || loading}
                onClick={connectGoogle}
                className={cn(
                  "w-full px-3 py-2 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity",
                  (busy === "google" || loading) && "opacity-60 cursor-not-allowed",
                )}
              >
                {busy === "google" ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </div>

        {/* Voyager CRM */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-[hsl(var(--dropdown-hover))] flex items-center justify-center shrink-0 overflow-hidden">
                <img src={voyagerLogo} alt="Voyager CRM" className="w-7 h-7 object-contain" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-foreground text-base">Voyager CRM</div>
                <div className="text-muted-foreground text-sm truncate">
                  {voyagerConnected ? "Personal API key" : "Not connected"}
                </div>
              </div>
            </div>
            {voyagerConnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-sm text-foreground/80 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(140_70%_42%)]" />
                Connected
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Sync contacts, companies and deals with your Voyager CRM. The AI can
            create and look up records on your behalf.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { icon: Mail, label: "Contacts" },
              { icon: Briefcase, label: "Companies" },
              { icon: Calendar, label: "Deals" },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <span
                  key={f.label}
                  className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-sm text-foreground/70"
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </span>
              );
            })}
          </div>
          <div className="mt-auto pt-1 space-y-2">
            {voyagerConnected ? (
              <button
                type="button"
                disabled={busy === "voyager" || loading}
                onClick={disconnectVoyager}
                className={cn(
                  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-dropdown-hover transition-colors",
                  (busy === "voyager" || loading) && "opacity-60 cursor-not-allowed",
                )}
              >
                {busy === "voyager" ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <>
                <input
                  type="password"
                  value={voyagerKey}
                  onChange={(e) => setVoyagerKey(e.target.value)}
                  placeholder="vyg_live_..."
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
                <button
                  type="button"
                  disabled={busy === "voyager" || loading || !voyagerKey.trim()}
                  onClick={connectVoyager}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity",
                    (busy === "voyager" || loading || !voyagerKey.trim()) &&
                      "opacity-60 cursor-not-allowed",
                  )}
                >
                  {busy === "voyager" ? "Connecting…" : "Connect"}
                </button>
                <p className="text-xs text-muted-foreground">
                  Create a key in Voyager → Settings → Developer. Requires Pro or Max plan.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
