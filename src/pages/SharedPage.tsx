// Public viewer for a shared page (/p/:token).
// Anyone (signed-out included) can open it as long as the row is_public=true.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageRenderer, type PageSpec } from "@/components/PageRenderer";

type State =
  | { kind: "loading" }
  | { kind: "ok"; page: PageSpec; title: string }
  | { kind: "not_found" };

export default function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("shared_pages")
        .select("title, page, is_public")
        .eq("share_token", token)
        .eq("is_public", true)
        .maybeSingle();
      if (error || !data) {
        setState({ kind: "not_found" });
        return;
      }
      setState({
        kind: "ok",
        page: data.page as unknown as PageSpec,
        title: data.title,
      });
    })();
  }, [token]);

  useEffect(() => {
    if (state.kind === "ok") document.title = state.title;
  }, [state]);

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (state.kind === "not_found") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <div className="text-foreground text-lg font-semibold mb-2">Page not available</div>
        <p className="text-muted-foreground text-sm max-w-md">
          This shared link has been revoked or no longer exists.
        </p>
      </div>
    );
  }

  const theme = state.page.theme ?? "paper";
  const bg =
    theme === "midnight" ? "bg-[#0F1624]" :
    theme === "minimal" ? "bg-white" :
    theme === "forest" ? "bg-[#0D1F1A]" :
    theme === "slate" ? "bg-[#F4F6F8]" :
    "bg-[#F5F1E8]";

  return (
    <div className={`min-h-screen ${bg}`}>
      <PageRenderer page={state.page} />
    </div>
  );
}
