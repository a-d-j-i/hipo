// Minimal React tree shown when the in-page backend hasn't been
// bootstrapped on this device yet. Renders the Bootstrap page only —
// no AuthProvider (the API endpoints aren't even running), no router
// (the page handles its own internal tab state). On successful
// bootstrap or restore, the page reloads and the regular App mounts.

import { ConfigProvider } from "antd";
import { PassphraseProvider } from "./bootstrap/PassphraseContext";
import Bootstrap from "./pages/Bootstrap";

export default function BootstrapApp() {
  return (
    <ConfigProvider>
      <PassphraseProvider>
        <Bootstrap />
      </PassphraseProvider>
    </ConfigProvider>
  );
}
