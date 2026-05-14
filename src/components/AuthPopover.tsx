import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getOAuthRedirectUri } from "@/lib/oauthRedirect";
import maveIcon from "@/assets/mave_icon.svg";

type Mode = "signin" | "signup";

export function AuthPopover() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("auth-popover-dismissed") === "1";
  });
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setOpen(false);
      setEmail("");
      setPassword("");
    }
  }, [user]);

  useEffect(() => {
    const handler = () => {
      setDismissed(false);
      setOpen(true);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("auth-popover-dismissed");
      }
    };
    window.addEventListener("open-auth-popover", handler);
    return () => window.removeEventListener("open-auth-popover", handler);
  }, []);

  if (loading || user) return null;

  const dismiss = () => {
    setDismissed(true);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("auth-popover-dismissed", "1");
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: getOAuthRedirectUri(),
    });
    if (result.error) {
      setGoogleLoading(false);
      toast.error(result.error.message ?? "Google sign-in failed");
      return;
    }
    if (result.redirected) return;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: { emailRedirectTo: getOAuthRedirectUri() },
      });
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Account created! Check your inbox to confirm your email.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Welcome back!");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="relative rounded-2xl border border-border bg-card shadow-xl p-6">
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-3 right-3 p-1 rounded hover:bg-dropdown-hover transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center mb-5 mt-1" style={{ gap: 44 }}>
          <img src={maveIcon} alt="Mave" className="w-12 h-12 rounded-xl" />
          <div className="text-center">
            <h3 className="font-semibold text-lg">
              {mode === "signup" ? "Create your account" : "Connect to your account"}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Save and personalize your searches
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={googleLoading}
          className={cn(
            "w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-background border border-border font-medium hover:bg-dropdown-hover transition-colors text-base",
            googleLoading && "opacity-60 cursor-not-allowed",
          )}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 43.5c5 0 9.5-1.7 13-4.6l-6-5c-2 1.4-4.4 2.1-7 2.1-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.1 16.2 43.5 24 43.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6 5c-.4.4 6.7-4.9 6.7-14.3 0-1.2-.1-2.3-.4-3.5z" />
          </svg>
          {googleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            autoComplete="email"
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 text-base"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 text-base"
          />
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "w-full px-4 py-2.5 rounded-xl bg-foreground text-background font-semibold hover:opacity-90 transition-opacity text-sm",
              submitting && "opacity-60 cursor-not-allowed",
            )}
          >
            {submitting
              ? mode === "signup" ? "Creating account…" : "Signing in…"
              : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="w-full text-muted-foreground hover:text-foreground transition-colors text-sm"
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "No account yet? Create one"}
          </button>
        </form>
      </div>
    </div>
  );
}
