// Minimal React tree shown when the in-page backend hasn't been
// bootstrapped on this device yet. No auth context, no router — the
// bootstrap UI is self-contained. On success the page reloads.

import { PassphraseProvider } from "./PassphraseContext.tsx";
import Bootstrap from "./pages/Bootstrap.tsx";

export default function BootstrapApp() {
  return (
    <PassphraseProvider>
      <Bootstrap />
    </PassphraseProvider>
  );
}
