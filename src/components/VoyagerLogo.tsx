import { cn } from "@/lib/utils";

export const VOYAGER_LABEL = "Voyager CRM";

export function VoyagerLogo({ className }: { className?: string }) {
  // Simple monogram badge — no asset dependency.
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] font-semibold text-white",
        className,
      )}
      style={{
        background: "linear-gradient(135deg,#0062FF 0%,#3B82F6 100%)",
        fontSize: "0.65em",
        lineHeight: 1,
      }}
      aria-label="Voyager CRM"
    >
      V
    </span>
  );
}
