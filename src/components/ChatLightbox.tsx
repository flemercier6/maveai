// Lightweight global lightbox for chat images.
// Open: window.dispatchEvent(new CustomEvent("chat-lightbox", { detail: { src, alt } }))
import { useEffect, useState } from "react";
import { X } from "lucide-react";

type LightboxState = { src: string; alt?: string } | null;

export function ChatLightbox() {
  const [state, setState] = useState<LightboxState>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as LightboxState;
      if (detail?.src) setState(detail);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState(null);
    };
    window.addEventListener("chat-lightbox", onOpen as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("chat-lightbox", onOpen as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!state) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in"
      onClick={() => setState(null)}
      role="dialog"
      aria-modal="true"
      aria-label={state.alt || "Image preview"}
    >
      <button
        type="button"
        onClick={() => setState(null)}
        aria-label="Close image"
        className="absolute top-4 right-4 h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={state.src}
        alt={state.alt || ""}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {state.alt && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[80vw] text-center text-xs text-white/80 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {state.alt}
        </div>
      )}
    </div>
  );
}

export function openLightbox(src: string, alt?: string) {
  window.dispatchEvent(new CustomEvent("chat-lightbox", { detail: { src, alt } }));
}
