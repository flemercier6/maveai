import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send, FileText, X, Check, Loader2, ChevronDown, ArrowRight, ArrowUpRight, Clock, Copy } from "lucide-react";
import { GoogleServiceLogo } from "@/components/GoogleServiceLogo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import gmeetLogo from "@/assets/gmeet-logo.png";
import calendarLogo from "@/assets/logo-calendar.png";

export type GoogleActionState = "pending" | "executing" | "done" | "cancelled" | "error";

export type GoogleAction = {
  action: "gmail.draft" | "gmail.send" | "calendar.create";
  params: Record<string, unknown>;
  state: GoogleActionState;
  result?: unknown;
  error?: string;
  loading?: boolean;
};

type Props = {
  action: GoogleAction;
  onChange: (next: GoogleAction) => void;
};

function fmt(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function parseDateTime(iso: string): { date: string; time: string } | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const date = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { date, time };
  } catch { return null; }
}

function calcDuration(start: string, end: string): string {
  if (!start || !end) return "";
  try {
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (mins <= 0) return "";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${m}` : `${h}h`;
  } catch { return ""; }
}

function isoToTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function applyTime(iso: string, timeVal: string): string {
  if (!iso || !timeVal) return iso;
  const [hours, minutes] = timeVal.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function GoogleActionCard({ action, onChange }: Props) {
  const [params, setParams] = useState<Record<string, unknown>>(action.params);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setParams(action.params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.params, action.loading]);

  const isEmail = action.action === "gmail.draft" || action.action === "gmail.send";
  const isEvent = action.action === "calendar.create";
  const service: "gmail" | "calendar" = isEmail ? "gmail" : "calendar";

  const title =
    action.action === "gmail.draft"
      ? "Brouillon Gmail"
      : action.action === "gmail.send"
        ? "Envoyer un email"
        : "Créer un événement";

  const primaryLabel =
    action.action === "gmail.draft"
      ? "Créer le brouillon"
      : action.action === "gmail.send"
        ? "Envoyer"
        : "Créer l'événement";

  const handleConfirm = async (overrideAction?: GoogleAction["action"]) => {
    let effectiveAction = overrideAction ?? action.action;
    // Strip UI-only fields before sending
    const cleanParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith("_")) cleanParams[k] = v;
    }
    // If a draft event was already created (Google Meet pre-created), patch it instead
    const existingEventId = params._eventId as string | undefined;
    let body: { action: string; params: Record<string, unknown> };
    if (effectiveAction === "calendar.create" && existingEventId) {
      body = { action: "calendar.update", params: { ...cleanParams, eventId: existingEventId } };
    } else {
      body = { action: effectiveAction, params: cleanParams };
    }
    onChange({ ...action, action: effectiveAction, state: "executing", params: cleanParams });
    try {
      const { data, error } = await supabase.functions.invoke("google-tools", { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const result = (data as { result?: unknown })?.result;
      onChange({ ...action, action: effectiveAction, state: "done", params: cleanParams, result });
      const successMsg =
        effectiveAction === "gmail.draft"
          ? "Brouillon enregistré"
          : effectiveAction === "gmail.send"
            ? "Email envoyé"
            : "Événement créé";
      toast.success(successMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action échouée";
      onChange({ ...action, action: effectiveAction, state: "error", params: cleanParams, error: msg });
      toast.error(msg);
    }
  };

  const handleCancel = async () => {
    const existingEventId = params._eventId as string | undefined;
    if (existingEventId) {
      try {
        await supabase.functions.invoke("google-tools", {
          body: { action: "calendar.delete", params: { eventId: existingEventId } },
        });
      } catch (e) {
        console.error("Failed to delete draft event", e);
      }
    }
    onChange({ ...action, state: "cancelled" });
  };

  // ---------- Result view ----------
  if (action.state === "done") {
    const r = action.result as Record<string, unknown> | undefined;
    const isCalendar = action.action === "calendar.create";
    const label =
      action.action === "gmail.draft"
        ? "Brouillon enregistré dans Gmail"
        : action.action === "gmail.send"
          ? "Email envoyé"
          : "Événement créé";
    return (
      <div className="my-2 rounded-[14px] bg-secondary px-3 py-2 flex items-center justify-between gap-4 min-h-[45px]">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-[#00BA42]" strokeWidth={2.5} />
          <span className="text-foreground font-semibold" style={{ fontSize: 14 }}>
            {label}
          </span>
        </div>
        {isCalendar && r?.htmlLink ? (
          <div className="flex items-center gap-5">
            <a
              href={String(r.htmlLink)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-[5px] text-muted-foreground hover:text-foreground transition-colors"
              style={{ fontSize: 12 }}
            >
              <img
                src={calendarLogo}
                alt=""
                className="w-5 h-5 rounded-[50px] border border-border"
                draggable={false}
              />
              <span>Open Event</span>
              <ArrowUpRight className="w-3 h-3" strokeWidth={1} />
            </a>
            {r?.meetUrl ? (
              <a
                href={String(r.meetUrl)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-[5px] text-muted-foreground hover:text-foreground transition-colors"
                style={{ fontSize: 12 }}
              >
                <img
                  src={gmeetLogo}
                  alt=""
                  className="w-5 h-5 rounded-[50px] border border-border"
                  draggable={false}
                />
                <span>Join Google Meet</span>
                <ArrowUpRight className="w-3 h-3" strokeWidth={1} />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (action.state === "cancelled") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-base">
          <X className="w-4 h-4" />
          Action annulée
        </div>
      </div>
    );
  }

  if (action.state === "error") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-destructive">
          <X className="w-4 h-4" />
          <span className="font-medium text-foreground text-base">Échec de l'action</span>
        </div>
        {action.error ? (
          <p className="mt-1 text-xs text-muted-foreground">{action.error}</p>
        ) : null}
      </div>
    );
  }

  const busy = action.state === "executing";
  const loading = !!action.loading;

  // Calendar create — Figma design
  if (isEvent) {
    return (
      <CalendarEventCard
        params={params}
        onChange={setParams}
        onConfirm={() => handleConfirm()}
        onCancel={handleCancel}
        busy={busy}
        loading={loading}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        result={action.result as Record<string, unknown> | undefined}
      />
    );
  }

  // ---------- Email confirmation card ----------
  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-border bg-[hsl(var(--dropdown-hover))] hover:opacity-90 transition-opacity text-left"
      >
        <GoogleServiceLogo service={service} className="w-4 h-4" />
        <span className="font-medium text-foreground text-base flex-1 truncate">
          {title}
          {collapsed && isEmail && params.subject ? (
            <span className="ml-2 text-muted-foreground font-normal truncate">— {String(params.subject)}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("w-4 h-4 text-foreground/60 transition-transform", collapsed ? "-rotate-90" : "rotate-0")}
        />
      </button>

      {!collapsed && (
        <div className="p-3 space-y-2 text-sm">
          {loading ? (
            <EmailSkeleton />
          ) : (
            <EmailFields params={params} onChange={setParams} />
          )}
        </div>
      )}

      {!collapsed && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 bg-background">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy || loading}
            className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-dropdown-hover transition-colors disabled:opacity-50 text-base"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => handleConfirm("gmail.draft")}
            disabled={busy || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-dropdown-hover transition-colors disabled:opacity-50 text-base"
          >
            {busy && action.action === "gmail.draft" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Enregistrer comme brouillon
          </button>
          <button
            type="button"
            onClick={() => handleConfirm("gmail.send")}
            disabled={busy || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-60 text-base"
          >
            {busy && action.action === "gmail.send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Envoyer
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Calendar event card (Figma design) ----------

function EventPillInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 w-full bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
    />
  );
}

function EventRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[10px] w-full">
      <span className="text-[14px] text-foreground w-[60px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function AttendeeInput({
  attendees,
  onChange,
}: {
  attendees: string[];
  onChange: (next: string[]) => void;
}) {
  const [raw, setRaw] = useState("");

  const add = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (attendees.includes(trimmed)) return;
    onChange([...attendees, trimmed]);
  };

  const remove = (email: string) => {
    onChange(attendees.filter((a) => a !== email));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      add(raw);
      setRaw("");
    }
    if (e.key === "Backspace" && raw === "" && attendees.length > 0) {
      onChange(attendees.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (raw.trim()) {
      add(raw);
      setRaw("");
    }
  };

  return (
    <div className="flex flex-col gap-[6px]">
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Add participants"
        className="w-full bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
      />
      {attendees.length > 0 && (
        <div className="flex flex-wrap gap-[6px]">
          {attendees.map((email) => (
            <div
              key={email}
              className="inline-flex items-center gap-[6px] bg-input-primary-bg rounded-[10px] px-[10px] py-[6px] text-[12px] text-foreground"
            >
              <span className="truncate max-w-[200px]">{email}</span>
              <button
                type="button"
                onClick={() => remove(email)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Retirer ${email}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarEventCard({
  params,
  onChange,
  onConfirm,
  onCancel,
  busy,
  loading,
  collapsed,
  onToggleCollapse,
  result,
}: {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  result?: Record<string, unknown>;
}) {
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });

  const [meetLoading, setMeetLoading] = useState(false);

  const enableMeet = async () => {
    if (params.addMeet || meetLoading) return;
    setMeetLoading(true);
    const cleanParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith("_")) cleanParams[k] = v;
    }
    cleanParams.addMeet = true;
    try {
      const existingEventId = params._eventId as string | undefined;
      const body = existingEventId
        ? { action: "calendar.update", params: { ...cleanParams, eventId: existingEventId } }
        : { action: "calendar.create", params: cleanParams };
      const { data, error } = await supabase.functions.invoke("google-tools", { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const r = (data as { result?: { id?: string; meetUrl?: string } })?.result ?? {};
      const code = r.meetUrl ? String(r.meetUrl).replace(/^https?:\/\/meet\.google\.com\//, "").split("?")[0] : "";
      onChange({
        ...params,
        addMeet: true,
        _eventId: r.id ?? params._eventId,
        _meetUrl: r.meetUrl ?? null,
        _meetCode: code,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Impossible de créer le Meet";
      toast.error(msg);
    } finally {
      setMeetLoading(false);
    }
  };

  const disableMeet = async () => {
    if (!params.addMeet && !params._eventId) return;
    const existingEventId = params._eventId as string | undefined;
    if (existingEventId) {
      try {
        await supabase.functions.invoke("google-tools", {
          body: { action: "calendar.delete", params: { eventId: existingEventId } },
        });
      } catch (e) {
        console.error("Failed to delete draft event", e);
      }
    }
    const next = { ...params };
    delete next._eventId;
    delete next._meetUrl;
    delete next._meetCode;
    next.addMeet = false;
    onChange(next);
  };

  const start = parseDateTime(fmt(params.start));
  const end = parseDateTime(fmt(params.end));
  const duration = calcDuration(fmt(params.start), fmt(params.end));

  const host = fmt(params.organizer) || fmt(params.calendarId) || "";


  return (
    <div className="my-2 rounded-[20px] bg-background overflow-hidden flex flex-col gap-[11px] drop-shadow-[0_4px_5px_rgba(0,0,0,0.1)]">

      {/* Header */}
      <div
        className="bg-muted flex items-center justify-between px-[15px] py-[15px] rounded-t-[20px] cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-[10px]">
          <GoogleServiceLogo service="calendar" className="w-[18px] h-[18px]" />
          <span className="text-[14px] font-semibold text-foreground">Créer un événement</span>
        </div>
        <div className="flex items-center gap-[11px]" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Réduire"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", collapsed ? "rotate-[-90deg]" : "rotate-0")} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-[17px] h-[17px]" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Body */}
          <div className="flex flex-col gap-[10px] px-[15px]">
            {loading ? (
              <EventSkeleton />
            ) : (
              <>
                {/* Titre */}
                <EventRow label="Titre">
                  <EventPillInput
                    value={fmt(params.summary)}
                    onChange={(v) => set("summary", v)}
                    placeholder="Titre de l'événement"
                  />
                </EventRow>

                {/* Date + Time inline */}
                <div className="flex items-center gap-[10px] w-full flex-wrap">
                  <span className="text-[14px] text-foreground w-[60px] shrink-0">Date</span>

                  {/* Date picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground whitespace-nowrap hover:opacity-90 transition-opacity"
                      >
                        {start?.date ?? "—"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-50" align="start">
                      <Calendar
                        mode="single"
                        selected={params.start ? new Date(fmt(params.start)) : undefined}
                        onSelect={(d) => {
                          if (!d) return;
                          const applyDate = (iso: string): string => {
                            const base = iso ? new Date(iso) : new Date();
                            const next = new Date(base);
                            next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                            return next.toISOString();
                          };
                          onChange({
                            ...params,
                            start: applyDate(fmt(params.start)),
                            end: applyDate(fmt(params.end)),
                          });
                        }}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>

                  {/* Time, inline right after date */}
                  <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                  <input
                    type="time"
                    value={isoToTime(fmt(params.start))}
                    onChange={(e) =>
                      onChange({
                        ...params,
                        start: applyTime(fmt(params.start), e.target.value),
                      })
                    }
                    className="bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground outline-none"
                  />
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <input
                    type="time"
                    value={isoToTime(fmt(params.end))}
                    onChange={(e) =>
                      onChange({
                        ...params,
                        end: applyTime(fmt(params.end), e.target.value),
                      })
                    }
                    className="bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground outline-none"
                  />
                  {duration && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{duration}</span>
                  )}
                </div>

                {/* Separator */}
                <div className="h-px bg-border w-full" />

                {/* Host */}
                {host && (
                  <EventRow label="Host">
                    <div className="bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] text-foreground truncate">
                      {host}
                    </div>
                  </EventRow>
                )}

                {/* Invitees */}
                <div className="flex items-start gap-[10px] w-full">
                  <span className="text-[14px] text-foreground w-[60px] shrink-0 pt-[10px]">Invitees</span>
                  <div className="flex-1 min-w-0">
                    <AttendeeInput
                      attendees={Array.isArray(params.attendees) ? (params.attendees as string[]) : []}
                      onChange={(next) => onChange({ ...params, attendees: next })}
                    />
                  </div>
                </div>

                {/* Separator */}
                <div className="h-px bg-border w-full" />

                {/* Visio */}
                <EventRow label="Visio">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="bg-input-primary-bg px-[10px] py-[10px] rounded-[10px] text-[14px] flex items-center justify-between w-full hover:opacity-90 transition-opacity"
                      >
                        <span className={cn("flex items-center gap-[8px]", params.addMeet ? "text-foreground" : "text-muted-foreground")}>
                          {params.addMeet ? (
                            <>
                              <img src={gmeetLogo} alt="" className="w-[18px] h-[18px] object-contain rounded-full border border-border" />
                              Google Meet
                            </>
                          ) : (
                            "No visio-conference"
                          )}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-1 z-50" align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
                      <button
                        type="button"
                        onClick={disableMeet}
                        className="w-full flex items-center gap-[8px] px-[10px] py-[8px] rounded-[10px] text-[14px] text-foreground hover:bg-dropdown-hover"
                      >
                        No visio-conference
                      </button>
                      <button
                        type="button"
                        onClick={enableMeet}
                        disabled={meetLoading}
                        className="w-full flex items-center gap-[8px] px-[10px] py-[8px] rounded-[10px] text-[14px] text-foreground hover:bg-dropdown-hover disabled:opacity-60"
                      >
                        <img src={gmeetLogo} alt="" className="w-[18px] h-[18px] object-contain rounded-full border border-border" />
                        Google Meet
                        {meetLoading ? <Loader2 className="w-3 h-3 animate-spin ml-auto" /> : null}
                      </button>
                    </PopoverContent>
                  </Popover>
                </EventRow>

                {params.addMeet ? (
                  <div className="w-full border border-border rounded-[10px] bg-background p-[10px] flex flex-col gap-[6px]">
                    <div className="group flex items-center gap-[10px] text-sm">
                      <span className="text-muted-foreground w-[140px] shrink-0">Google Meet URL</span>
                      <span className="text-foreground truncate underline">
                        {meetLoading ? "Création…" : (params._meetUrl ? String(params._meetUrl) : (result?.meetUrl ? String(result.meetUrl) : "—"))}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const url = params._meetUrl ? String(params._meetUrl) : (result?.meetUrl ? String(result.meetUrl) : "");
                          if (url) {
                            navigator.clipboard.writeText(url);
                            toast.success("URL copiée");
                          }
                        }}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Copier l'URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="group flex items-center gap-[10px] text-sm">
                      <span className="text-muted-foreground w-[140px] shrink-0">Code</span>
                      <span className="text-foreground underline">
                        {meetLoading ? "…" : (params._meetCode ? String(params._meetCode) : "—")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const code = params._meetCode ? String(params._meetCode) : "";
                          if (code) {
                            navigator.clipboard.writeText(code);
                            toast.success("Code copié");
                          }
                        }}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Copier le code"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pb-[5px] pl-[15px] pr-[5px]">
            <button
              type="button"
              onClick={onCancel}
              className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <div className="flex items-center gap-[11px]">
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || loading}
                className="flex items-center gap-[10px] bg-primary text-primary-foreground text-[14px] px-[10px] py-[10px] rounded-[50px] hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <span>{Array.isArray(params.attendees) && (params.attendees as string[]).length > 0 ? "Create and Send" : "Create"}</span>
                    <ArrowRight className="w-3 h-3" />
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Sub-views ----------

function FieldRow({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground w-[60px] shrink-0 text-base">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring text-base"
    />
  );
}

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  minHeight = 60,
  maxHeight = 400,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, minHeight, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ minHeight, maxHeight }}
      className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring resize-none text-base"
    />
  );
}


function EmailFields({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  const showCc = !!fmt(params.cc) || (params as { _showCc?: boolean })._showCc;
  const showBcc = !!fmt(params.bcc) || (params as { _showBcc?: boolean })._showBcc;

  return (
    <>
      <FieldRow
        label="À"
        action={
          (!showCc || !showBcc) && (
            <div className="flex items-center text-base gap-0">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => onChange({ ...params, _showCc: true })}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-dropdown-hover transition-colors"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => onChange({ ...params, _showBcc: true })}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-dropdown-hover transition-colors"
                >
                  Cci
                </button>
              )}
            </div>
          )
        }
      >
        <TextInput value={fmt(params.to)} onChange={(v) => set("to", v)} placeholder="email@example.com" />
      </FieldRow>
      {showCc && (
        <FieldRow label="Cc">
          <TextInput value={fmt(params.cc)} onChange={(v) => set("cc", v)} placeholder="cc@example.com" />
        </FieldRow>
      )}
      {showBcc && (
        <FieldRow label="Cci">
          <TextInput value={fmt(params.bcc)} onChange={(v) => set("bcc", v)} placeholder="cci@example.com" />
        </FieldRow>
      )}
      <FieldRow label="Objet">
        <TextInput value={fmt(params.subject)} onChange={(v) => set("subject", v)} placeholder="Sujet" />
      </FieldRow>
      <div className="flex gap-2">
        <label className="text-muted-foreground w-[60px] shrink-0 pt-2 text-base">Corps</label>
        <AutoResizeTextarea
          value={fmt(params.body)}
          onChange={(v) => set("body", v)}
          placeholder="Contenu de l'email"
          minHeight={80}
          maxHeight={400}
        />
      </div>
    </>
  );
}

function EventFields({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  const attendees = Array.isArray(params.attendees)
    ? (params.attendees as string[]).join(", ")
    : "";

  return (
    <>
      <FieldRow label="Titre">
        <TextInput value={fmt(params.summary)} onChange={(v) => set("summary", v)} placeholder="Titre" />
      </FieldRow>
      <FieldRow label="Début">
        <TextInput value={fmt(params.start)} onChange={(v) => set("start", v)} placeholder="ISO 8601" />
      </FieldRow>
      <FieldRow label="Fin">
        <TextInput value={fmt(params.end)} onChange={(v) => set("end", v)} placeholder="ISO 8601" />
      </FieldRow>
      <FieldRow label="Lieu">
        <TextInput value={fmt(params.location)} onChange={(v) => set("location", v)} placeholder="Lieu" />
      </FieldRow>
      <FieldRow label="Invités">
        <TextInput
          value={attendees}
          onChange={(v) =>
            onChange({
              ...params,
              attendees: v.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="email1@..., email2@..."
        />
      </FieldRow>
      <div className="flex gap-2">
        <label className="text-muted-foreground w-[60px] shrink-0 pt-2 text-base">Détails</label>
        <AutoResizeTextarea
          value={fmt(params.description)}
          onChange={(v) => set("description", v)}
          placeholder="Description"
          minHeight={60}
          maxHeight={400}
        />
      </div>
    </>
  );
}

// ---------- Skeletons (shown while the LLM drafts the email/event) ----------

function SkeletonRow({ labelWidth = "w-6", inputWidth = "w-full" }: { labelWidth?: string; inputWidth?: string }) {
  return (
    <div className="flex items-center gap-2">
      <SkeletonShimmer className={cn("h-3 shrink-0", labelWidth)} style={{ width: 60 }} />
      <SkeletonShimmer className={cn("h-8", inputWidth)} />
    </div>
  );
}

function EmailSkeleton() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <div className="flex gap-2">
        <SkeletonShimmer className="h-3 shrink-0" style={{ width: 60 }} />
        <SkeletonShimmer className="h-32 flex-1" />
      </div>
    </>
  );
}

function EventSkeleton() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <div className="flex gap-2">
        <SkeletonShimmer className="h-3 shrink-0" style={{ width: 60 }} />
        <SkeletonShimmer className="h-20 flex-1" />
      </div>
    </>
  );
}
