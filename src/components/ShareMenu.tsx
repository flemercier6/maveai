import { useEffect, useState } from "react";
import { Copy, Check, Globe, Lock, Loader2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Share03Icon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  conversationId: string;
};

type ShareState = {
  isPublic: boolean;
  shareToken: string | null;
};

function randomToken(): string {
  // 22-char base36 token
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 22);
}

export function ShareMenu({ conversationId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<ShareState>({ isPublic: false, shareToken: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("conversations")
      .select("is_public, share_token")
      .eq("id", conversationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Could not load sharing settings");
        } else if (data) {
          setState({
            isPublic: !!data.is_public,
            shareToken: data.share_token ?? null,
          });
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const shareUrl = state.shareToken
    ? `${window.location.origin}/s/${state.shareToken}`
    : "";

  async function togglePublic(next: boolean) {
    if (!conversationId) return;
    setSaving(true);
    const token = next ? state.shareToken ?? randomToken() : state.shareToken;
    const { error } = await supabase
      .from("conversations")
      .update({
        is_public: next,
        share_token: token,
        shared_at: next ? new Date().toISOString() : null,
      })
      .eq("id", conversationId);
    setSaving(false);
    if (error) {
      toast.error("Could not update sharing");
      return;
    }
    setState({ isPublic: next, shareToken: token });
    toast.success(next ? "Conversation is now public" : "Sharing disabled");
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 gap-1.5 font-medium text-base"
        >
          <HugeiconsIcon icon={Share03Icon} className="w-4 h-4" strokeWidth={2} />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px] p-3">
        <div className="flex items-start gap-2 mb-3">
          <div className="mt-0.5">
            {state.isPublic ? (
              <Globe className="w-4 h-4 text-foreground" />
            ) : (
              <Lock className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">Public link</div>
            <div className="text-muted-foreground text-sm">
              Anyone with the link can view this conversation in read-only.
            </div>
          </div>
          <Switch
            checked={state.isPublic}
            disabled={loading || saving}
            onCheckedChange={togglePublic}
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        ) : state.isPublic && shareUrl ? (
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 h-8 rounded-[4px] border border-input bg-background px-2 text-xs text-foreground"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={copyLink}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-1">
            Sharing is off. New messages stay private.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
