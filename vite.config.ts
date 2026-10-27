import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: { "/api": "http://localhost:4317" },
  },
});
