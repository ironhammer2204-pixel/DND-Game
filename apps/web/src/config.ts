const IS_PROD = import.meta.env.PROD;

export const API_URL = import.meta.env.VITE_API_URL || (IS_PROD 
  ? window.location.origin 
  : "http://localhost:3001");

export const WS_URL = import.meta.env.VITE_WS_URL || (IS_PROD
  ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
  : "ws://localhost:3001");
