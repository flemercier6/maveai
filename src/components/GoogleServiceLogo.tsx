import gmailLogoUrl from "@/assets/logo-gmail.png";
import calendarLogoUrl from "@/assets/logo-calendar.png";
import driveLogoUrl from "@/assets/logo-drive.png";
import { cn } from "@/lib/utils";

export type GoogleService = "gmail" | "calendar" | "drive";

export const GOOGLE_SERVICE_LABEL: Record<GoogleService, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  drive: "Drive",
};

function GmailLogo({ className }: { className?: string }) {
  return (
    <img
      src={gmailLogoUrl}
      alt="Gmail"
      className={cn("rounded-[50px] border border-border", className)}
      draggable={false}
    />
  );
}

function CalendarLogo({ className }: { className?: string }) {
  return (
    <img
      src={calendarLogoUrl}
      alt="Calendar"
      className={cn("rounded-[50px] border border-border", className)}
      draggable={false}
    />
  );
}

function DriveLogo({ className }: { className?: string }) {
  return (
    <img
      src={driveLogoUrl}
      alt="Drive"
      className={cn("rounded-[50px] border border-border", className)}
      draggable={false}
    />
  );
}

const LOGOS: Record<GoogleService, React.ComponentType<{ className?: string }>> = {
  gmail: GmailLogo,
  calendar: CalendarLogo,
  drive: DriveLogo,
};

export function GoogleServiceLogo({
  service,
  className,
}: {
  service: GoogleService;
  className?: string;
}) {
  const Logo = LOGOS[service];
  return <Logo className={className} />;
}
