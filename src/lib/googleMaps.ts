// Lazy-load the Google Maps JS API once per page.
let loaderPromise: Promise<typeof google> | null = null;
let cachedKey: string | null = null;

async function fetchKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-maps-key`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to load Maps key (${res.status})`);
  const data = (await res.json()) as { key?: string; error?: string };
  if (!data.key) throw new Error(data.error || "No Maps key");
  cachedKey = data.key;
  return data.key;
}

declare global {
  interface Window {
    __gmapsCallback?: () => void;
    google?: typeof google;
  }
}

export async function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window !== "undefined" && window.google?.maps) {
    return window.google;
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = (async () => {
    const key = await fetchKey();
    return await new Promise<typeof google>((resolve, reject) => {
      const cbName = `__gmapsCb_${Date.now()}`;
      (window as any)[cbName] = () => {
        if (window.google?.maps) resolve(window.google);
        else reject(new Error("Google Maps failed to initialize"));
        try { delete (window as any)[cbName]; } catch { /* ignore */ }
      };
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cbName}&libraries=places&v=weekly`;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error("Failed to load Google Maps script"));
      document.head.appendChild(script);
    });
  })();

  return loaderPromise;
}
