import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import biome from "vite-plugin-biome";

export default defineConfig({
  plugins: [
    vue(),
    biome({
      mode: "check",
      files: "./src",
      hotUpdateMode: "changed",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    sourcemap: true,
    // naive-ui 按需导入后单块仍约 620 kB（gzip 163 kB），属第三方库固有体积，放宽阈值避免噪音。
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // 主包过大会触发构建告警，按依赖域拆块以降低单块体积并提升缓存命中率。
        manualChunks: {
          vue: ["vue", "vue-router", "pinia"],
          naive: ["naive-ui"],
          editor: ["@tiptap/vue-3", "@tiptap/starter-kit", "@tiptap/extension-placeholder"],
        },
      },
    },
  },
});
