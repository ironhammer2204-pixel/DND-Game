import type { WsStatus } from "../stores/gameStore";

interface WsReconnectBannerProps {
  status: WsStatus;
}

export function WsReconnectBanner({ status }: WsReconnectBannerProps) {
  if (status === "connected") return null;

  const isConnecting = status === "connecting";

  return (
    <div
      className={`ws-banner ${isConnecting ? "ws-banner--connecting" : "ws-banner--disconnected"}`}
      role="status"
      aria-live="polite"
    >
      <span className="ws-banner__dot" />
      <span className="ws-banner__text">
        {isConnecting
          ? "Connecting to server\u2026 (this may take up to 30 seconds on cold start)"
          : "Connection lost \u2014 attempting to reconnect\u2026"}
      </span>
    </div>
  );
}
