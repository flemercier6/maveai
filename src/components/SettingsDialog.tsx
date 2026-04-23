import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Settings, Sparkles, Globe } from "lucide-react";
import { UsageTab } from "@/components/UsageTab";

type Section = "preferences" | "integrations" | "usage";

const NAV: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "preferences", label: "Preferences", icon: Settings },
  { id: "integrations", label: "Integrations", icon: Globe },
  { id: "usage", label: "Usage", icon: Sparkles },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [active, setActive] = useState<Section>("preferences");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 overflow-hidden max-w-3xl w-[min(880px,92vw)] h-[min(560px,80vh)] flex gap-0"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your preferences, integrations and usage.
        </DialogDescription>

        {/* Sidebar */}
        <aside className="w-[200px] shrink-0 bg-[hsl(var(--dropdown-hover))] border-r border-border p-3 flex flex-col gap-1">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Settings
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-[4px] text-sm text-left transition-colors",
                  isActive
                    ? "bg-background text-foreground font-medium"
                    : "text-foreground/70 hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="w-4 h-4 opacity-70" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {active === "preferences" && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Preferences</h2>
              <p className="text-sm text-muted-foreground">
                Customize how the app looks and behaves.
              </p>
            </section>
          )}
          {active === "integrations" && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-sm text-muted-foreground">
                Connect external services and providers.
              </p>
            </section>
          )}
          {active === "usage" && <UsageTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
