import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 前端单测配置：Node 环境跑纯函数，不必启动 WebView。
 * 与 vite.config.ts 共用 `@` 别名，测试里的路径写法与业务代码一致。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // 测试统一放在仓根 tests/，与业务源码分离；通过 @ 别名引用被测模块。
    include: ["tests/**/*.test.ts"],
  },
});
