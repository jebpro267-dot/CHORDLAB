import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig, type Plugin } from "vite";

const adminPathRedirect: Plugin = {
  name: "chordlab-admin-path-redirect",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const [pathname, search = ""] = (request.url ?? "").split("?", 2);
      if (pathname !== "/admin") return next();
      response.statusCode = 308;
      response.setHeader("Location", `/admin/${search ? `?${search}` : ""}`);
      response.end();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const [pathname, search = ""] = (request.url ?? "").split("?", 2);
      if (pathname !== "/admin") return next();
      response.statusCode = 308;
      response.setHeader("Location", `/admin/${search ? `?${search}` : ""}`);
      response.end();
    });
  },
};

export default defineConfig({
  plugins: [
    adminPathRedirect,
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
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
    rollupOptions: {
      input: {
        user: "index.html",
        admin: "admin/index.html",
      },
    },
  },
});
