import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // `npm run dev` uses --mode offline: no Cloudflare login needed, but no AI fallback
    // (only exact, alias, plural and typo matches are accepted). `npm run dev:ai` turns it on.
    cloudflare({ remoteBindings: mode !== "offline" }),
  ],
}));
