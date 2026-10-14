import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    // OFFLINE=1 skips remote bindings (Workers AI) so dev works without a Cloudflare login.
    // The AI fallback then just reports "not on the list".
    cloudflare({ remoteBindings: process.env.OFFLINE !== "1" }),
  ],
});
