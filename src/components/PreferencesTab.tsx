import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  onProfileUpdated?: () => void;
};

export function PreferencesTab({ onProfileUpdated }: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Load profile
  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setName((data?.display_name as string | null) ?? "");
        setAvatarUrl((data?.avatar_url as string | null) ?? null);
      });
  }, [user]);

  const handleFile = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      // Path must start with the user id folder for RLS
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      onProfileUpdated?.();
      toast.success("Profile picture updated");
    } catch (e) {
      console.error(e);
      toast.error("Could not upload picture");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setUploading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user.id);
      if (error) throw error;
      setAvatarUrl(null);
      onProfileUpdated?.();
      toast.success("Profile picture removed");
    } catch (e) {
      console.error(e);
      toast.error("Could not remove picture");
    } finally {
      setUploading(false);
    }
  };

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name.trim() || null })
        .eq("id", user.id);
      if (error) throw error;
      onProfileUpdated?.();
      toast.success("Name updated");
    } catch (e) {
      console.error(e);
      toast.error("Could not update name");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold mb-8">Preference</h1>

      {/* Appearance */}
      <section className="mb-2">
        <h2 className="text-muted-foreground mb-4 text-base">Appearance</h2>
        <div className="flex items-start justify-between py-4 text-base border-b border-border pt-0">
          <div>
            <div className="font-medium text-base">Appearance mode</div>
            <div className="text-muted-foreground mt-0.5 text-sm">
              Personalize the appearance of your account for a better experience.
            </div>
          </div>
          <span className="font-semibold uppercase tracking-wider rounded-full bg-foreground/10 text-foreground/60 px-2 py-1 text-xs">
            Soon
          </span>
        </div>
      </section>

      {/* Profile */}
      <section className="mt-8">
        <h2 className="text-muted-foreground mb-4 text-base">Profile</h2>

        {/* Picture */}
        <div className="py-4 text-base pt-0 pb-[16px]">
          <div className="font-medium text-base">Picture</div>
          <div className="text-muted-foreground mt-0.5 mb-4 text-sm">
            Personalize your profile with your picture. Your picture will appear in your left-menu.
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-muted overflow-hidden flex items-center justify-center text-lg font-medium uppercase text-muted-foreground">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                (name?.[0] ?? email?.[0] ?? "?")
              )}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-muted hover:bg-dropdown-hover font-medium transition-colors text-sm",
                  uploading && "opacity-60 cursor-not-allowed",
                )}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : "Change"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={handleDelete}
                  className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                >
                  Delete
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {/* Name */}
        <div className="py-4 text-base pt-0 pb-[16px]">
          <label className="font-medium text-base">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            disabled={savingName}
            placeholder="ex: John"
            className="mt-2 w-full px-3 py-2 rounded-[6px] bg-muted placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-border text-base"
          />
        </div>

        {/* Email */}
        <div className="py-4 text-base pt-0 pb-[16px]">
          <label className="font-medium text-base">Email</label>
          <input
            type="email"
            value={email}
            disabled
            placeholder="ex: john.doe@gmail.com"
            className="mt-2 w-full px-3 py-2 rounded-[6px] bg-muted text-base text-muted-foreground placeholder:text-muted-foreground/60 cursor-not-allowed"
          />
        </div>
      </section>
    </div>
  );
}
