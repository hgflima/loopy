import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^loopy\//, replacement: "@hgflima/loopy/" }],
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
