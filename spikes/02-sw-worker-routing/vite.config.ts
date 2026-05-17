import { defineConfig } from "vite";
import sqlocal from "sqlocal/vite";

export default defineConfig({
  plugins: [sqlocal()],
  server: {
    port: 5175,
    strictPort: true,
  },
  worker: {
    format: "es",
  },
});
