import { Compass } from "lucide-react";

type Props = {
  rect: DOMRect;
  onClick: () => void;
};

/**
 * Floating "Explore" button that appears above a text selection inside
 * an assistant message. Positioned with fixed coords relative to the viewport.
 */
export function ExploreButton({ rect, onClick }: Props) {
  // Center horizontally over the selection, sit 8px above its top edge.
  const top = Math.max(8, rect.top - 40);
  const left = rect.left + rect.width / 2;

  return (
    <button
      type="button"
      // Use onMouseDown so the click fires before the selection collapses
      // from the subsequent document mouseup.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="fixed z-50 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-medium shadow-lg animate-fade-in hover:opacity-90 transition-opacity"
      style={{ top, left, transform: "translateX(-50%)" }}
    >
      <Compass className="w-3.5 h-3.5" />
      Explore
    </button>
  );
}
