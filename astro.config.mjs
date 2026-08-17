// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

import { headers } from "./scripts/headers.mjs";

try {
  process.loadEnvFile(".env");
} catch {}

const { PUBLIC_SUPABASE_URL } = process.env;

// https://astro.build/config
export default defineConfig({
  site: "https://dondeayudar.com.co",

  integrations: [headers(PUBLIC_SUPABASE_URL)],

  vite: {
    plugins: [tailwindcss()],

    build: {
      chunkSizeWarningLimit: 600,
    },
  },
});
