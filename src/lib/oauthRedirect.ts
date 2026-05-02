const APP_REDIRECT_URI = "maveai://oauth";

type NativeWindow = Window &
  typeof globalThis & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    ReactNativeWebView?: unknown;
  };

const isAllowedMobileRedirect = (value: string) =>
  value.startsWith("maveai://") || value.startsWith("exp://");

function getExplicitMobileRedirectUri(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const explicit =
    params.get("oauth_redirect_uri") ??
    params.get("native_redirect_uri") ??
    window.localStorage.getItem("oauth_redirect_uri");

  if (explicit && isAllowedMobileRedirect(explicit)) {
    window.localStorage.setItem("oauth_redirect_uri", explicit);
    return explicit;
  }

  return null;
}

export function isNativeMobileOAuthContext(): boolean {
  if (typeof window === "undefined") return false;

  const nativeWindow = window as NativeWindow;
  const platform = nativeWindow.Capacitor?.getPlatform?.();
  const isCapacitorNative = nativeWindow.Capacitor?.isNativePlatform?.() === true;
  const protocol = window.location.protocol;
  const userAgent = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS)/i.test(userAgent);
  const isIosWebView = isIos && !isSafari;

  return Boolean(
    getExplicitMobileRedirectUri() ||
      (isCapacitorNative && platform === "ios") ||
      protocol === "capacitor:" ||
      protocol === "ionic:" ||
      nativeWindow.ReactNativeWebView ||
      isIosWebView,
  );
}

export function getOAuthRedirectUri(): string {
  if (typeof window === "undefined") return APP_REDIRECT_URI;
  return getExplicitMobileRedirectUri() ??
    (isNativeMobileOAuthContext() ? APP_REDIRECT_URI : window.location.origin);
}

export function getOAuthReturnUri(): string {
  if (typeof window === "undefined") return APP_REDIRECT_URI;
  return getExplicitMobileRedirectUri() ??
    (isNativeMobileOAuthContext() ? APP_REDIRECT_URI : window.location.href);
}

export function shouldUseFullPageOAuthRedirect(): boolean {
  if (typeof window === "undefined") return false;
  return isNativeMobileOAuthContext() || /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}