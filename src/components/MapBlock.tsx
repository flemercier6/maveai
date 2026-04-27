import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { SkeletonShimmer } from "./SkeletonShimmer";

type Marker = {
  lat: number;
  lng: number;
  label?: string;
  description?: string;
};

type Spec = {
  title?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: Marker[];
};

type Props = { code: string };

function parseSpec(code: string): Spec | null {
  try {
    const raw = JSON.parse(code);
    if (typeof raw !== "object" || raw === null) return null;
    const markers: Marker[] = Array.isArray(raw.markers)
      ? raw.markers
          .filter((m: any) => typeof m?.lat === "number" && typeof m?.lng === "number")
          .map((m: any) => ({
            lat: m.lat,
            lng: m.lng,
            label: typeof m.label === "string" ? m.label : undefined,
            description: typeof m.description === "string" ? m.description : undefined,
          }))
      : [];
    const center =
      raw.center && typeof raw.center.lat === "number" && typeof raw.center.lng === "number"
        ? { lat: raw.center.lat, lng: raw.center.lng }
        : undefined;
    return {
      title: typeof raw.title === "string" ? raw.title : undefined,
      center,
      zoom: typeof raw.zoom === "number" ? raw.zoom : undefined,
      markers,
    };
  } catch {
    return null;
  }
}

function MapBlockImpl({ code }: Props) {
  const spec = useMemo(() => parseSpec(code), [code]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // Init map once
  useEffect(() => {
    let cancelled = false;
    if (!spec) {
      setStatus("error");
      setError("Invalid map data");
      return;
    }
    if (!containerRef.current) return;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return;
        const fallbackCenter = spec.markers?.[0]
          ? { lat: spec.markers[0].lat, lng: spec.markers[0].lng }
          : spec.center ?? { lat: 48.8566, lng: 2.3522 };
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: spec.center ?? fallbackCenter,
          zoom: spec.zoom ?? 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
        });
        infoRef.current = new google.maps.InfoWindow();
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(e?.message ?? "Failed to load map");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers when spec changes (or after map ready)
  useEffect(() => {
    if (status !== "ready" || !spec || !mapRef.current || !window.google) return;
    const google = window.google;

    // clear old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const markers = spec.markers ?? [];
    if (markers.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    markers.forEach((m, i) => {
      const marker = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: mapRef.current,
        title: m.label ?? `Point ${i + 1}`,
        label: markers.length > 1
          ? { text: String(i + 1), color: "#fff", fontSize: "12px", fontWeight: "600" }
          : undefined,
      });
      if (m.label || m.description) {
        marker.addListener("click", () => {
          const html = `
            <div style="font-family: inherit; max-width: 220px;">
              ${m.label ? `<div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(m.label)}</div>` : ""}
              ${m.description ? `<div style="font-size:12px;color:#555;">${escapeHtml(m.description)}</div>` : ""}
              <a href="https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#1a73e8;display:inline-block;margin-top:6px;">Open in Google Maps ↗</a>
            </div>`;
          infoRef.current?.setContent(html);
          infoRef.current?.open({ anchor: marker, map: mapRef.current });
        });
      }
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
    });

    if (markers.length > 1) {
      mapRef.current.fitBounds(bounds, 60);
    } else if (markers.length === 1) {
      mapRef.current.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      mapRef.current.setZoom(spec.zoom ?? 14);
    }
  }, [spec, status]);

  if (!spec) {
    return (
      <div className="my-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <AlertCircle className="inline w-4 h-4 mr-1.5 -mt-0.5" />
        Invalid map data
      </div>
    );
  }

  const openInMapsUrl = (() => {
    const m = spec.markers?.[0];
    if (m) return `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`;
    if (spec.center) return `https://www.google.com/maps/@${spec.center.lat},${spec.center.lng},${spec.zoom ?? 12}z`;
    return null;
  })();

  return (
    <div className="my-4 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            {spec.title || (spec.markers && spec.markers.length > 1 ? `${spec.markers.length} locations` : "Map")}
          </span>
        </div>
        {openInMapsUrl && (
          <a
            href={openInMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Google Maps <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="relative w-full h-[360px] bg-muted">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <SkeletonShimmer className="w-full h-full" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
            <div>
              <AlertCircle className="w-5 h-5 mx-auto mb-2" />
              {error || "Could not load map"}
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const MapBlock = memo(MapBlockImpl);
