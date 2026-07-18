import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(rootDir, "src/ui/jarvis-react");

export default defineConfig({
  root: uiRoot,
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.resolve(rootDir, "src/ui/jarvis"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(uiRoot, "index.html"),
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react")) return "vendor-react";
          if (id.includes("motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("ogl")) return "vendor-visual";
          return "vendor";
        }
      }
    }
  }
});
