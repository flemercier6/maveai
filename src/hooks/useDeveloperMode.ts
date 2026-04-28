import { useEffect, useState, useCallback } from "react";

const KEY = "developer-mode";
const EVENT = "developer-mode-change";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useDeveloperMode(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => read());

  useEffect(() => {
    const onChange = () => setEnabled(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const set = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setEnabled(v);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [enabled, set];
}
