import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "chordlab-admin-root-entry",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const [pathname, search = ""] = (request.url ?? "").split("?", 2);
          if (pathname === "/") request.url = `/admin/index.html${search ? `?${search}` : ""}`;
          next();
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "admin-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: "admin/index.html" },
    },
  },
});