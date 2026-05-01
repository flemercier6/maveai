import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Check } from "lucide-react";

type Reason = "daily-limit" | "premium-model" | "memory" | "folder" | "save-chat";

const COPY: Record<Reason, { title: string; description: string }> = {
  "daily-limit": {
    title: "You've used your 5 free messages today",
    description:
      "Upgrade to Plus for unlimited messages, access to premium models, persistent chats, projects and memory.",
  },
  "premium-model": {
    title: "This model is reserved for Plus",
    description:
      "GPT-5.5, Claude Opus 4.7, Gemini Pro and Mistral Large are available on the Plus plan. Switch to a free model or upgrade.",
  },
  memory: {
    title: "Memory is a Plus feature",
    description:
      "On Plus, the assistant remembers facts about you across all conversations and providers.",
  },
  folder: {
    title: "Folders are a Plus feature",
    description:
      "Group your chats by project, set folder-level instructions and memory. Available on Plus.",
  },
  "save-chat": {
    title: "Saved chats are a Plus feature",
    description:
      "On the free plan, every chat is ephemeral. Upgrade to Plus to keep your conversation history in the sidebar.",
  },
};

const PLUS_FEATURES = [
  "Unlimited messages per day",
  "All premium models (GPT-5.5, Opus 4.7, Gemini Pro…)",
  "Saved chats & folders",
  "Persistent memory across conversations",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: Reason;
};

export function UpgradeDialog({ open, onOpenChange, reason }: Props) {
  const copy = COPY[reason];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" overlayClassName="bg-white/40 backdrop-blur-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-foreground/10 text-foreground/70 px-2 py-0.5">
              Plus
            </span>
          </div>
          <DialogTitle className="text-left">{copy.title}</DialogTitle>
          <DialogDescription className="text-left">{copy.description}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          {PLUS_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-foreground/70" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              window.dispatchEvent(
                new CustomEvent("open-settings", { detail: { section: "billing" } }),
              );
            }}
          >
            <Sparkles className="w-4 h-4 mr-1" /> Upgrade to Plus
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
