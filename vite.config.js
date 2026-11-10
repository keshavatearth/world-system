import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 5199 },
  resolve: { dedupe: ["three", "@react-three/fiber", "postprocessing"] },
  optimizeDeps: { include: ["three", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing"] },
});
