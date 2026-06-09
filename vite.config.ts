import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      port: 3000,
      host: true,
      allowedHosts: ["deduce-punk-defiling.ngrok-free.dev"],
    },
  },
});
