import voyagerLogoUrl from "@/assets/logo-voyager.png";

export const VOYAGER_LABEL = "Voyager CRM";

export function VoyagerLogo({ className }: { className?: string }) {
  return (
    <img
      src={voyagerLogoUrl}
      alt="Voyager CRM"
      className={className}
      draggable={false}
    />
  );
}
