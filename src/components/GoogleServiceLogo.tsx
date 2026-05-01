import type { SVGProps } from "react";
import gmailLogoUrl from "@/assets/logo-gmail.png";

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

function CalendarLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2" fill="#fff" stroke="#E0E0E0"/>
      <path d="M3 8h18v2H3z" fill="#4285F4"/>
      <path d="M7 3v3M17 3v3" stroke="#5F6368" strokeWidth="1.5" strokeLinecap="round"/>
      <text x="12" y="18" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="700" fill="#4285F4">31</text>
    </svg>
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

const LOGOS: Record<GoogleService, React.ComponentType<SVGProps<SVGSVGElement>>> = {
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
  return <Logo className={className} aria-label={GOOGLE_SERVICE_LABEL[service]} />;
}
