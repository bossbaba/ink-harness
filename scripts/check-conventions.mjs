/**
 * 工程规范静态守卫：把项目约定固化成可执行的 CI 检查，避免「有红线没人守」。
 *
 * 检查四件事：
 * 1. 手写的 src/**、tests/**、src-tauri/src/** 单文件不超过 500 行（自动生成文件不在此列）；
 * 2. composables / views 不直接 import `@/api/tauri`（必须经 services 层）；
 * 3. components 不直接 import `@/services/*` 的运行时符号（类型导入允许，运行时必须走 props/emit）；
 * 4. `preset="card"` 的 NModal 必须显式给宽度（否则会撑满整个窗口）。
 *
 * 退出码非 0 表示有违规；输出每条违规的文件与行号，便于直接定位。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FAILURES = [];
const MAX_LINES = 500;

/** 递归收集指定目录下的源码文件。 */
function collect(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full, exts));
    } else if (exts.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const frontendFiles = [
  ...collect(join(ROOT, "src"), [".ts", ".vue", ".scss"]),
  ...collect(join(ROOT, "tests"), [".ts"]),
];
const backendFiles = collect(join(ROOT, "src-tauri/src"), [".rs"]);

// 1. 单文件行数红线。测试文件同样受此约束，避免把违规藏进测试目录。
for (const file of [...frontendFiles, ...backendFiles]) {
  const lines = readFileSync(file, "utf8").split("\n").length;
  if (lines > MAX_LINES) {
    FAILURES.push(`行数超限：${relative(ROOT, file)} 共 ${lines} 行（上限 ${MAX_LINES}）`);
  }
}

// 2/3. 分层导入约束：只匹配真正的 import，跳过注释行。
const LAYER_RULES = [
  {
    label: "composables/views 直连 IPC",
    dirs: [join(ROOT, "src/composables"), join(ROOT, "src/views")],
    pattern: /^\s*import\s+.*from\s+["']@\/api\/tauri["']/m,
  },
  {
    label: "components 直连 service（类型导入除外）",
    dirs: [join(ROOT, "src/components")],
    // import type ... from "@/services/..." 是纯类型，运行时无副作用，允许。
    pattern: /^\s*import\s+(?!type\b)[^;]*from\s+["']@\/services\//m,
  },
];

for (const rule of LAYER_RULES) {
  for (const dir of rule.dirs) {
    for (const file of collect(dir, [".ts", ".vue"])) {
      const text = readFileSync(file, "utf8");
      const match = rule.pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split("\n").length;
        FAILURES.push(`${rule.label}：${relative(ROOT, file)}:${line}`);
      }
    }
  }
}

// 4. 弹窗宽度约束：card 预设没有默认宽度上限，漏写就会横跨全屏、输入框被拉散。
//    统一要求用 utils/modal.ts 的 modalStyle(...)（旧的内联 :style 带 width 也放行）。
for (const file of collect(join(ROOT, "src"), [".vue"])) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/<NModal\b[^>]*>/g)) {
    const tag = match[0];
    if (!tag.includes('preset="card"')) continue;
    const hasWidth = tag.includes("modalStyle(") || /(?::)?style="[^"]*width/.test(tag);
    if (hasWidth) continue;
    const line = text.slice(0, match.index).split("\n").length;
    FAILURES.push(
      `弹窗缺少宽度约束：${relative(ROOT, file)}:${line}（preset="card" 需用 modalStyle(...) 指定宽度）`,
    );
  }
}

if (FAILURES.length > 0) {
  console.error(`工程规范检查未通过：\n${FAILURES.map((item) => `  - ${item}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `工程规范检查通过：${frontendFiles.length} 个前端文件、${backendFiles.length} 个后端文件，行数与分层均合规。`,
);
