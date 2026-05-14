import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Spin } from "antd";
import { Navigate } from "react-router";
import type { User } from "../bindings/User";
import * as api from "./api";

type AuthState = {
  ready: boolean;
  needsSetup: boolean;
  currentUser: User | null;
};

type AuthValue = AuthState & {
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<User>;
  setupFirstAdmin: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    needsSetup: false,
    currentUser: null,
  });

  const refresh = useCallback(async () => {
    const status = await api.authStatus();
    setState({
      ready: true,
      needsSetup: status.needs_setup,
      currentUser: status.current_user,
    });
  }, []);

  useEffect(() => {
    (async () => {
      const status = await api.authStatus();
      setState({
        ready: true,
        needsSetup: status.needs_setup,
        currentUser: status.current_user,
      });
      const autoLogin = import.meta.env.VITE_AUTO_LOGIN;
      if (!autoLogin || status.current_user) return;

      const [username, password] = autoLogin.includes(":")
        ? autoLogin.split(":", 2)
        : ["admin", "admin123"];

      if (status.needs_setup) {
        try {
          await api.setupFirstAdmin({ username, password });
          // eslint-disable-next-line no-console
          console.info(`[hipo] auto-setup created admin "${username}"`);
          await refresh();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[hipo] auto-setup failed:", e);
        }
      } else {
        try {
          await api.login({ username, password });
          await refresh();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            `[hipo] auto-login failed for "${username}" — wrong credentials? Override with VITE_AUTO_LOGIN=user:pass`,
            e,
          );
        }
      }
    })();
  }, [refresh]);

  const value: AuthValue = {
    ...state,
    refresh,
    login: async (username, password) => {
      const user = await api.login({ username, password });
      await refresh();
      return user;
    },
    setupFirstAdmin: async (username, password) => {
      const user = await api.setupFirstAdmin({ username, password });
      await refresh();
      return user;
    },
    logout: async () => {
      await api.logout();
      await refresh();
    },
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}

function FullPageSpin() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
      }}
    >
      <Spin />
    </div>
  );
}

export function RequireSetup({ children }: { children: ReactNode }) {
  const { ready, needsSetup, currentUser } = useAuth();
  if (!ready) return <FullPageSpin />;
  if (!needsSetup) return <Navigate to={currentUser ? "/" : "/login"} replace />;
  return <>{children}</>;
}

export function RequireLogin({ children }: { children: ReactNode }) {
  const { ready, needsSetup, currentUser } = useAuth();
  if (!ready) return <FullPageSpin />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (currentUser) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, needsSetup, currentUser } = useAuth();
  if (!ready) return <FullPageSpin />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!currentUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  if (!currentUser || currentUser.role !== "admin")
    return <Navigate to="/" replace />;
  return <>{children}</>;
}
