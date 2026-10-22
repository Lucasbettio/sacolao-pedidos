import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH: no GitHub Pages o site fica em /<nome-do-repo>/ (o workflow define isso).
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
});
