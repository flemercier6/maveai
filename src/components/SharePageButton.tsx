// Share/publish a generated PageSpec as a public link (Claude Artifacts style).
// • Owner-only control. Creates a row in `shared_pages`, returns a /p/:token URL.
// • Link is revocable (toggle is_public=false) and re-publishable.
// • Public visitors (signed-out included) can open via the link, but the page
//   is never listed in anyone else's UI.
import { useEffect, useState } from "react";
import { Share2, Copy, Check, Link2Off } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PageSpec } from "./PageRenderer";

type Props = {
  page: PageSpec;
  /** Stable id per chat-message so we reuse the same shared row instead of duplicating. */
  pageKey: string;
  className?: string;
};

type ShareRow = {
  id: string;
  share_token: string;
  is_public: boolean;
};

const STORAGE_PREFIX = "shared-page:";

export function SharePageButton({ page, pageKey, className }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<ShareRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const storageKey = `${STORAGE_PREFIX}${pageKey}`;

  // Look up an existing share row for this page (stored locally per pageKey).
  useEffect(() => {
    if (!user) return;
    const existingId = localStorage.getItem(storageKey);
    if (!existingId) return;
    void (async () => {
      const { data } = await supabase
        .from("shared_pages")
        .select("id, share_token, is_public")
        .eq("id", existingId)
        .maybeSingle();
      if (data) setRow(data as ShareRow);
    })();
  }, [user, storageKey]);

  const shareUrl = row ? `${window.location.origin}/p/${row.share_token}` : "";

  const publish = async () => {
    if (!user) {
      toast.error("Sign in to publish a page");
      return;
    }
    setBusy(true);
    try {
      const pageJson = JSON.parse(JSON.stringify(page));
      if (row) {
        const { error } = await supabase
          .from("shared_pages")
          .update({ is_public: true, page: pageJson, title: page.title })
          .eq("id", row.id);
        if (error) throw error;
        setRow({ ...row, is_public: true });
      } else {
        const { data, error } = await supabase
          .from("shared_pages")
          .insert([{
            user_id: user.id,
            title: page.title,
            page: pageJson,
            is_public: true,
          }])
          .select("id, share_token, is_public")
          .single();
        if (error) throw error;
        setRow(data as ShareRow);
        localStorage.setItem(storageKey, (data as ShareRow).id);
      }
      toast.success("Shareable link ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!row) return;
    setBusy(true);
    const { error } = await supabase
      .from("shared_pages")
      .update({ is_public: false })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRow({ ...row, is_public: false });
    toast.success("Link revoked");
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isLive = row?.is_public === true;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Share page"
          className={cn(
            "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-full text-xs font-medium transition-colors",
            className,
          )}
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>{isLive ? "Shared" : "Share"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-foreground">Share this page</div>
          {row && (
            <Switch
              checked={isLive}
              disabled={busy}
              onCheckedChange={(v) => (v ? publish() : revoke())}
            />
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-3 leading-snug">
          {isLive
            ? "Anyone with the link can view this page. It won't appear in anyone else's account."
            : row
              ? "The link has been revoked. Re-enable to share again."
              : "Publish to create a shareable link. Only people with the link can view it."}
        </p>

        {isLive ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 h-9 px-2.5 text-sm rounded-md border border-input bg-background text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="button" size="sm" variant="outline" onClick={copy} className="h-9">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={publish}
              disabled={busy}
              className="h-9 flex-1"
            >
              <Share2 className="w-3.5 h-3.5" />
              {row ? "Re-enable link" : "Publish & copy link"}
            </Button>
            {row && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  localStorage.removeItem(storageKey);
                  setRow(null);
                }}
                title="Forget this share"
                className="h-9"
              >
                <Link2Off className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
