import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  plugins: [nitro(), workflow(), react(), tailwindcss()],
  nitro: {
    serverDir: "./",
    vercel: {
      functions: {
        runtime: "nodejs24.x",
      },
    },
  },
  server: {
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
  },
});
