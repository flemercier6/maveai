import type { SVGProps } from "react";
import gmailLogoUrl from "@/assets/logo-gmail.png";
import calendarLogoUrl from "@/assets/logo-calendar.png";

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
      className={className}
      draggable={false}
    />
  );
}

function CalendarLogo({ className }: { className?: string }) {
  return (
    <img
      src={calendarLogoUrl}
      alt="Calendar"
      className={className}
      draggable={false}
    />
  );
}

function DriveLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M9 3h6l6 10.5h-6z" fill="#FBBC04"/>
      <path d="M9 3l-6 10.5L6 19l6-10.5z" fill="#34A853"/>
      <path d="M6 19h12l3-5.5H9z" fill="#4285F4"/>
    </svg>
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
