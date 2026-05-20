import { lazy, Suspense } from "react";
import { ConfigProvider, Spin } from "antd";
import { BrowserRouter, Route, Routes } from "react-router";
import {
  AuthProvider,
  RequireAdmin,
  RequireAuth,
  RequireLogin,
  RequireSetup,
} from "./auth/AuthContext";
import { PassphraseProvider } from "./bootstrap/PassphraseContext";
import { CadenceRunner } from "./backup/CadenceRunner";
import AppLayout from "./layouts/AppLayout";

// Per-route code splitting. Each page becomes its own chunk and is fetched
// on first navigation; AppLayout + auth context stay in the entry bundle so
// the shell paints immediately.
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Loans = lazy(() => import("./pages/Loans"));
const Login = lazy(() => import("./pages/Login"));
const Parties = lazy(() => import("./pages/Parties"));
const Payouts = lazy(() => import("./pages/Payouts"));
const Settings = lazy(() => import("./pages/Settings"));
const Setup = lazy(() => import("./pages/Setup"));
const Users = lazy(() => import("./pages/Users"));

function PageFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "200px",
        width: "100%",
      }}
    >
      <Spin />
    </div>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter>
        <AuthProvider>
          <PassphraseProvider>
            <CadenceRunner />
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route
                  path="/setup"
                  element={
                    <RequireSetup>
                      <Setup />
                    </RequireSetup>
                  }
                />
                <Route
                  path="/login"
                  element={
                    <RequireLogin>
                      <Login />
                    </RequireLogin>
                  }
                />
                <Route
                  element={
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<Dashboard />} />
                  <Route path="parties" element={<Parties />} />
                  <Route path="loans" element={<Loans />} />
                  <Route path="payouts" element={<Payouts />} />
                  <Route
                    path="users"
                    element={
                      <RequireAdmin>
                        <Users />
                      </RequireAdmin>
                    }
                  />
                  <Route
                    path="audit"
                    element={
                      <RequireAdmin>
                        <AuditLog />
                      </RequireAdmin>
                    }
                  />
                  <Route path="settings" element={<Settings />} />
                </Route>
              </Routes>
            </Suspense>
          </PassphraseProvider>
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  );
}
