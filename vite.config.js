import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.BACKEND_PROXY_TARGET || "http://127.0.0.1:18081",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.BACKEND_PROXY_TARGET || "http://127.0.0.1:18081",
        ws: true,
      },
    },
  },
});
