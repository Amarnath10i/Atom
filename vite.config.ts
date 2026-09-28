import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Nitro turns the TanStack Start build into something a host can run.
// On Vercel (VERCEL=1 during builds) it emits the Build Output API layout;
// everywhere else it emits a standalone Node server at .output/server/index.mjs.
// NITRO_PRESET overrides both.
const preset = process.env.NITRO_PRESET ?? (process.env.VERCEL ? "vercel" : "node-server");

export default defineConfig({
  nitro: { preset },
  vite: {
    server: {
      port: 3000,
      host: true,
      allowedHosts: true,
    },
  },
});
