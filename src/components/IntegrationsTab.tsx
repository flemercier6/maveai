import { useState } from "react";
import { Mail, Calendar, HardDrive, Database, Users, Building2, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIntegrations } from "@/hooks/useIntegrations";
import { cn } from "@/lib/utils";
import { getOAuthReturnUri, shouldUseFullPageOAuthRedirect } from "@/lib/oauthRedirect";
import geminiLogo from "@/assets/gemini-logo.png";

type ProviderDef = {
  id: string;
  title: string;
  description: string;
  features: { icon: React.ComponentType<{ className?: string }>; label: string }[];
} & (
  | { kind: "oauth"; logo: string }
  | { kind: "static"; logoIcon: React.ComponentType<{ className?: string }>; alwaysOn?: boolean }
);

const PROVIDERS: ProviderDef[] = [
  {
    id: "google",
    kind: "oauth",
    title: "Google",
    description:
      "Connect Gmail, Calendar and Drive so the AI can read and draft emails, manage events and pull files.",
    logo: geminiLogo,
    features: [
      { icon: Mail, label: "Gmail" },
      { icon: Calendar, label: "Calendar" },
      { icon: HardDrive, label: "Drive" },
    ],
  },
  {
    id: "voyager",
    kind: "static",
    title: "Voyager CRM",
    description:
      "Sync contacts, companies and deals with your Voyager CRM. The AI can create and look up records on your behalf.",
    logoIcon: Database,
    alwaysOn: true,
    features: [
      { icon: Users, label: "Contacts" },
      { icon: Building2, label: "Companies" },
      { icon: Briefcase, label: "Deals" },
    ],
  },
];

export function IntegrationsTab() {
  const { integrations, loading, isConnected, refresh } = useIntegrations();
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (provider: string) => {
    setBusy(provider);
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
      // Open in a popup so the user stays in context.
      const popup = window.open(url, "google-oauth", "width=520,height=640");
      if (!popup) {
        // Fallback to full redirect if popups are blocked.
        window.location.href = url;
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : `Could not start ${provider} connection`,
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: string) => {
    setBusy(provider);
    try {
      const { error } = await supabase.functions.invoke(
        "google-oauth-disconnect",
      );
      if (error) throw error;
      toast.success(`${provider} disconnected`);
      await refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : `Could not disconnect ${provider}`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-6 max-w-3xl">
      <header>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect external services so the AI can act on your behalf.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((p) => {
          const isStatic = p.kind === "static";
          const connected = isStatic ? !!p.alwaysOn : isConnected(p.id);
          const account = integrations.find((i) => i.provider === p.id);
          const isBusy = busy === p.id;
          return (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {p.kind === "oauth" ? (
                    <img
                      src={p.logo}
                      alt={p.title}
                      className="w-10 h-10 rounded-lg object-contain shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[hsl(var(--dropdown-hover))] flex items-center justify-center shrink-0">
                      <p.logoIcon className="w-5 h-5 text-foreground/70" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-base">
                      {p.title}
                    </div>
                    {p.kind === "oauth" && connected && account?.account_email ? (
                      <div className="text-muted-foreground text-sm truncate">
                        {account.account_email}
                      </div>
                    ) : null}
                    {isStatic ? (
                      <div className="text-muted-foreground text-sm truncate">
                        Workspace API key
                      </div>
                    ) : null}
                  </div>
                </div>
                {connected && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-sm text-foreground/80 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(140_70%_42%)]" />
                    {isStatic ? "Active" : "Synced"}
                  </span>
                )}
              </div>

              <p className="text-muted-foreground text-sm">{p.description}</p>

              <div className="flex flex-wrap gap-1.5">
                {p.features.map((f) => {
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
                {isStatic ? (
                  <div className="text-sm text-muted-foreground">
                    Managed at the workspace level — always available to the AI.
                  </div>
                ) : connected ? (
                  <button
                    type="button"
                    disabled={isBusy || loading}
                    onClick={() => disconnect(p.id)}
                    className={cn(
                      "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-dropdown-hover transition-colors",
                      (isBusy || loading) && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    {isBusy ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || loading}
                    onClick={() => connect(p.id)}
                    className={cn(
                      "w-full px-3 py-2 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity",
                      (isBusy || loading) && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    {isBusy ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
