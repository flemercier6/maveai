import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getOAuthRedirectUri } from "@/lib/oauthRedirect";
import fevrierLogo from "@/assets/fevrier-logo.svg";

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
      if (error) { toast.error(error.message); return; }
      toast.success("Account created! Check your inbox to confirm your email.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
      setSubmitting(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Welcome back!");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[216px] min-w-[250px]">
      <div className="bg-muted rounded-[15px] pt-[16px] pb-[20px] pl-[25px] pr-[17px] flex flex-col gap-[18px]">

        {/* Close + Logo */}
        <div className="flex flex-col gap-[12px]">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="w-[14px] h-[14px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-[11px] h-[11px]" strokeWidth={2} />
            </button>
          </div>
          <div className="flex justify-center">
            <img
              src={fevrierLogo}
              alt="fevrier"
              className="h-[16px] w-auto dark:invert"
            />
          </div>
        </div>

        {/* Title + subtitle */}
        <div className="flex flex-col gap-[5px] items-center text-center">
          <p className="text-[14px] font-semibold text-foreground leading-normal">
            Connect or Create an account
          </p>
          <p className="text-[10px] font-normal text-muted-foreground leading-normal">
            Save and personalize your searches
          </p>
        </div>

        {/* Google button */}
        <button
          type="button"
          onClick={onGoogle}
          disabled={googleLoading}
          className={cn(
            "w-full flex items-center justify-center gap-[10px] px-[10px] py-[7px] rounded-[8px] bg-background border border-border hover:opacity-90 transition-opacity",
            googleLoading && "opacity-60 cursor-not-allowed",
          )}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 43.5c5 0 9.5-1.7 13-4.6l-6-5c-2 1.4-4.4 2.1-7 2.1-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.1 16.2 43.5 24 43.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6 5c-.4.4 6.7-4.9 6.7-14.3 0-1.2-.1-2.3-.4-3.5z" />
          </svg>
          <span className="text-[12px] font-medium text-foreground whitespace-nowrap">
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </span>
        </button>

        {/* Separator */}
        <div className="h-px w-full bg-border" />

        {/* Email + password + submit */}
        <form onSubmit={onSubmit} className="flex flex-col gap-[10px]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            autoComplete="email"
            className="w-full px-[10px] py-[7px] rounded-[8px] bg-muted border border-border text-[10px] text-foreground placeholder:text-muted-foreground outline-none focus:border-muted-foreground transition-colors"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full px-[10px] py-[7px] rounded-[8px] bg-muted border border-border text-[10px] text-foreground placeholder:text-muted-foreground outline-none focus:border-muted-foreground transition-colors"
          />
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "w-full px-[10px] py-[7px] rounded-[10px] bg-primary text-primary-foreground text-[10px] font-semibold hover:opacity-90 transition-opacity",
              submitting && "opacity-60 cursor-not-allowed",
            )}
          >
            {submitting
              ? mode === "signup" ? "Creating account…" : "Signing in…"
              : "Continue with email"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="text-[9px] text-muted-foreground hover:text-foreground transition-colors text-center"
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
