import { useCallback, useEffect, useState } from "react";
import * as authApi from "./auth-api";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authed"; user: authApi.AuthUser };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const user = await authApi.me();
      setState(user ? { status: "authed", user } : { status: "anonymous" });
    } catch {
      // Network hiccup etc. — show the login screen rather than spin forever.
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    state,
    login: async () => {
      setState({ status: "authed", user: await authApi.login() });
    },
    register: async (input: Parameters<typeof authApi.register>[0]) => {
      setState({ status: "authed", user: await authApi.register(input) });
    },
    logout: async () => {
      await authApi.logout();
      setState({ status: "anonymous" });
    },
    // Any 401 from a later API call should funnel here too (PR4+).
    toAnonymous: () => setState({ status: "anonymous" }),
  };
}
