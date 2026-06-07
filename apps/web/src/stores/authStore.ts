import { create } from "zustand";

interface AuthUser {
  id: string;
  email: string;
  username: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
}

const storedToken = localStorage.getItem("dnd_token");
const storedUser = localStorage.getItem("dnd_user");

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  user: storedUser ? (JSON.parse(storedUser) as AuthUser) : null,

  setSession: (token, user) => {
    localStorage.setItem("dnd_token", token);
    localStorage.setItem("dnd_user", JSON.stringify(user));
    set({ token, user });
  },

  clearSession: () => {
    localStorage.removeItem("dnd_token");
    localStorage.removeItem("dnd_user");
    set({ token: null, user: null });
  },
}));
