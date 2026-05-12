import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";

async function bootstrap() {
  if (import.meta.env.VITE_USE_MOCKS) {
    await import("./mocks/ipc");
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
