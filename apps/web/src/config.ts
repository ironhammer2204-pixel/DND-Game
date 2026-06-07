const IS_PROD = import.meta.env.PROD;
const PROD_API_URL = "https://dnd-game-server.onrender.com";

function isTunnelUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /run\.pinggy-free\.link|ngrok|localhost|127\.0\.0\.1/i.test(value);
}

const DEFAULT_API_URL = IS_PROD ? PROD_API_URL : "http://localhost:3001";
const DEFAULT_WS_URL = IS_PROD
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
  : "ws://localhost:3001";

const configuredApiUrl = import.meta.env.VITE_API_URL;

export const API_URL = !IS_PROD
  ? (configuredApiUrl || DEFAULT_API_URL)
  : (configuredApiUrl && !isTunnelUrl(configuredApiUrl) ? configuredApiUrl : DEFAULT_API_URL);
export const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;

const API_CANDIDATES = Array.from(
  new Set(
    [
      !IS_PROD ? configuredApiUrl : undefined,
      IS_PROD ? PROD_API_URL : undefined,
      !IS_PROD ? window.location.origin : undefined,
      "http://localhost:3001",
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0 && !isTunnelUrl(value)
    )
  )
);

let resolvedApiUrl: string | null = null;

export function getApiCandidates() {
  return API_CANDIDATES;
}

export async function resolveApiUrl(): Promise<string> {
  if (resolvedApiUrl) return resolvedApiUrl;

  for (const candidate of API_CANDIDATES) {
    try {
      const res = await fetch(`${candidate}/health`, {
        method: "GET",
        headers: {
          "ngrok-skip-browser-warning": "true",
          "bypass-tunnel-reminder": "true",
        },
      });

      if (res.ok) {
        resolvedApiUrl = candidate;
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  resolvedApiUrl = API_URL;
  return resolvedApiUrl ?? DEFAULT_API_URL;
}
