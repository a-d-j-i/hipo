// Renders before the rest of the app when this tab couldn't acquire
// the single-tab Web Lock — another tab already owns the OPFS handle.
// Polls for lock release and reloads automatically.

import { useEffect, useState } from "react";
import { observeLockReleased } from "@hipo/server";

export default function MultiTabBlock() {
  const [released, setReleased] = useState(false);

  useEffect(() => {
    const stop = observeLockReleased(() => {
      setReleased(true);
      setTimeout(() => location.reload(), 600);
    });
    return stop;
  }, []);

  return (
    <div className="center-wrap">
      <div className="card">
        <h2>Already open in another tab</h2>
        <p className="hint">
          This app only runs in one tab at a time. Close the other tab to
          continue here, or switch back to it.
        </p>
        <div className="status">
          {released ? "Resuming…" : "Waiting for the other tab to close…"}
        </div>
      </div>
    </div>
  );
}
