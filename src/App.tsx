import { ConfigProvider } from "antd";
import { BrowserRouter, Route, Routes } from "react-router";
import {
  AuthProvider,
  RequireAdmin,
  RequireAuth,
  RequireLogin,
  RequireSetup,
} from "./auth/AuthContext";
import AppLayout from "./layouts/AppLayout";
import AuditLog from "./pages/AuditLog";
import Dashboard from "./pages/Dashboard";
import Loans from "./pages/Loans";
import Login from "./pages/Login";
import Parties from "./pages/Parties";
import Payouts from "./pages/Payouts";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import Users from "./pages/Users";

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter>
        <AuthProvider>
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
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  );
}
