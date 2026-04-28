import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { SkeletonShimmer } from "./SkeletonShimmer";

type Marker = {
  lat: number;
  lng: number;
  label?: string;
  description?: string;
};

type RouteProfile = "driving" | "walking" | "cycling" | "driving-traffic";

type RouteSpec = {
  profile?: RouteProfile;
  /** Ordered list of waypoints (≥2). If omitted, falls back to `markers` order. */
  waypoints?: { lat: number; lng: number }[];
};

type Spec = {
  title?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: Marker[];
  route?: RouteSpec;
};

type Props = { code: string };

let cachedToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-mapbox-token`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    });
    if (!res.ok) throw new Error(`Failed to load Mapbox token (${res.status})`);
    const data = (await res.json()) as { token?: string; error?: string };
    if (!data.token) throw new Error(data.error || "No Mapbox token");
    cachedToken = data.token;
    return data.token;
  })();
  return tokenPromise;
}

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
    let route: RouteSpec | undefined;
    if (raw.route && typeof raw.route === "object") {
      const profile: RouteProfile = ["driving", "walking", "cycling", "driving-traffic"].includes(raw.route.profile)
        ? raw.route.profile
        : "driving";
      const wps = Array.isArray(raw.route.waypoints)
        ? raw.route.waypoints
            .filter((w: any) => typeof w?.lat === "number" && typeof w?.lng === "number")
            .map((w: any) => ({ lat: w.lat, lng: w.lng }))
        : undefined;
      route = { profile, waypoints: wps };
    }
    return {
      title: typeof raw.title === "string" ? raw.title : undefined,
      center,
      zoom: typeof raw.zoom === "number" ? raw.zoom : undefined,
      markers,
      route,
    };
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatDuration(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

type RouteData = { geometry: GeoJSON.LineString; distance: number; duration: number };

async function fetchRoute(token: string, spec: Spec): Promise<RouteData | null> {
  const route = spec.route;
  if (!route) return null;
  const wps = route.waypoints?.length
    ? route.waypoints
    : (spec.markers ?? []).map((m) => ({ lat: m.lat, lng: m.lng }));
  if (wps.length < 2) return null;
  const coords = wps.map((w) => `${w.lng},${w.lat}`).join(";");
  const profile = route.profile || "driving";
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions API ${res.status}`);
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r?.geometry) return null;
  return { geometry: r.geometry, distance: r.distance, duration: r.duration };
}

function MapBlockImpl({ code }: Props) {
  const spec = useMemo(() => parseSpec(code), [code]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number; profile: RouteProfile } | null>(null);

  // Init map
  useEffect(() => {
    let cancelled = false;
    if (!spec) {
      setStatus("error");
      setError("Invalid map data");
      return;
    }
    if (!containerRef.current) return;

    fetchToken()
      .then((token) => {
        if (cancelled || !containerRef.current) return;
        mapboxgl.accessToken = token;
        const fallbackCenter = spec.markers?.[0]
          ? { lat: spec.markers[0].lat, lng: spec.markers[0].lng }
          : spec.center ?? { lat: 48.8566, lng: 2.3522 };
        const center = spec.center ?? fallbackCenter;
        mapRef.current = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [center.lng, center.lat],
          zoom: spec.zoom ?? 12,
        });
        mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        mapRef.current.on("load", () => {
          if (!cancelled) setStatus("ready");
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(e?.message ?? "Failed to load map");
      });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers + route
  useEffect(() => {
    if (status !== "ready" || !spec || !mapRef.current) return;
    const map = mapRef.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const markers = spec.markers ?? [];
    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;

    markers.forEach((m) => {
      const popupHtml = `
        <div style="font-family: inherit; max-width: 220px;">
          ${m.label ? `<div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(m.label)}</div>` : ""}
          ${m.description ? `<div style="font-size:12px;color:#555;">${escapeHtml(m.description)}</div>` : ""}
          <a href="https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#1a73e8;display:inline-block;margin-top:6px;">Open in Maps ↗</a>
        </div>`;
      const marker = new mapboxgl.Marker({ color: "hsl(var(--primary))" })
        .setLngLat([m.lng, m.lat]);
      if (m.label || m.description) {
        marker.setPopup(new mapboxgl.Popup({ offset: 24, closeButton: false }).setHTML(popupHtml));
      }
      marker.addTo(map);
      markersRef.current.push(marker);
      bounds.extend([m.lng, m.lat]);
      hasBounds = true;
    });

    // Cleanup any previous route layer
    if (map.getLayer("map-route-line")) map.removeLayer("map-route-line");
    if (map.getSource("map-route")) map.removeSource("map-route");
    setRouteInfo(null);

    let cancelled = false;
    const drawRoute = async () => {
      if (!spec.route) return;
      try {
        const token = await fetchToken();
        const data = await fetchRoute(token, spec);
        if (cancelled || !data || !mapRef.current) return;
        const m = mapRef.current;
        m.addSource("map-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: data.geometry } });
        m.addLayer({
          id: "map-route-line",
          type: "line",
          source: "map-route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "hsl(var(--primary))",
            "line-width": 4,
            "line-opacity": 0.9,
          },
        });
        // Extend bounds to route
        const rb = new mapboxgl.LngLatBounds();
        for (const c of data.geometry.coordinates) rb.extend(c as [number, number]);
        const merged = hasBounds ? bounds.extend(rb.getNorthEast()).extend(rb.getSouthWest()) : rb;
        m.fitBounds(merged, { padding: 60, duration: 0 });
        setRouteInfo({ distance: data.distance, duration: data.duration, profile: spec.route.profile || "driving" });
      } catch (e) {
        console.error("Route fetch failed", e);
      }
    };

    if (markers.length > 1 && !spec.route) {
      map.fitBounds(bounds, { padding: 60, duration: 0 });
    } else if (markers.length === 1 && !spec.route) {
      map.setCenter([markers[0].lng, markers[0].lat]);
      map.setZoom(spec.zoom ?? 14);
    }
    drawRoute();

    return () => {
      cancelled = true;
    };
  }, [spec, status]);

  if (!spec) {
    return (
      <div className="my-4 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
        <Globe className="inline w-4 h-4 mr-1.5 -mt-0.5" />
        Invalid map data
      </div>
    );
  }

  const openInMapsUrl = (() => {
    const wps = spec.route?.waypoints ?? (spec.markers ?? []).map((m) => ({ lat: m.lat, lng: m.lng }));
    if (spec.route && wps.length >= 2) {
      const profileMap: Record<RouteProfile, string> = {
        driving: "driving",
        "driving-traffic": "driving",
        walking: "walking",
        cycling: "bicycling",
      };
      const travel = profileMap[spec.route.profile || "driving"];
      const origin = `${wps[0].lat},${wps[0].lng}`;
      const destination = `${wps[wps.length - 1].lat},${wps[wps.length - 1].lng}`;
      const waypoints = wps.slice(1, -1).map((w) => `${w.lat},${w.lng}`).join("|");
      const wpParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${travel}${wpParam}`;
    }
    const m = spec.markers?.[0];
    if (m) return `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`;
    if (spec.center) return `https://www.google.com/maps/@${spec.center.lat},${spec.center.lng},${spec.zoom ?? 12}z`;
    return null;
  })();

  return (
    <div className="my-4 rounded-xl border border-border bg-background overflow-hidden w-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate font-sans">
            {spec.title || (spec.markers && spec.markers.length > 1 ? `${spec.markers.length} locations` : "Map")}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {routeInfo && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {formatDistance(routeInfo.distance)} · {formatDuration(routeInfo.duration)}
            </span>
          )}
          {openInMapsUrl && (
            <a
              href={openInMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Open <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <div className="relative w-full h-[320px] bg-background">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <SkeletonShimmer className="w-full h-full" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
            <div>
              <Globe className="w-5 h-5 mx-auto mb-2" />
              {error || "Could not load map"}
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

export const MapBlock = memo(MapBlockImpl);
