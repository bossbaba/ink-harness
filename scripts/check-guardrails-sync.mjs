/**
 * 脱敏规则跨端一致性守卫。
 *
 * TS 与 Rust 各有自己的脱敏实现（前端拦工具观察、后端拦网关输出），
 * 规则表只能手工双源维护。这里从两端源码提取前缀表和占位文案做对比，
 * 防止只改了一边导致某些凭据在其中一条链路上明文漏出。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TS_FILE = join(ROOT, "src/services/guardrails.ts");
const RS_FILE = join(ROOT, "src-tauri/src/services/guardrails.rs");

function section(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return "";
  return text.slice(start, text.indexOf("];", start) + 2);
}

function normalize(entries) {
  return entries
    .map(([prefix, min]) => `${prefix}:${min}`)
    .sort()
    .join(",");
}

const ts = readFileSync(TS_FILE, "utf8");
const rs = readFileSync(RS_FILE, "utf8");

const tsPrefixes = [
  ...section(ts, "const TOKEN_PREFIXES").matchAll(/\[\s*["']([^"']+)["']\s*,\s*(\d+)\s*\]/g),
].map((match) => [match[1], match[2]]);
const rsPrefixes = [
  ...section(rs, "const TOKEN_PREFIXES").matchAll(/\(\s*"([^"]+)"\s*,\s*(\d+)\s*\)/g),
].map((match) => [match[1], match[2]]);

const tsMask = /export const MASK = "([^"]+)"/.exec(ts)?.[1];
const rsMask = /pub const MASK: &str = "([^"]+)"/.exec(rs)?.[1];
const errors = [];

if (tsPrefixes.length === 0 || rsPrefixes.length === 0) {
  errors.push("前缀表提取失败：两端必须都能解析出规则，避免空表互相匹配蒙混过关");
} else if (normalize(tsPrefixes) !== normalize(rsPrefixes)) {
  errors.push(`前缀表不一致：\n  TS  ${normalize(tsPrefixes)}\n  Rust ${normalize(rsPrefixes)}`);
}
if (!tsMask || !rsMask || tsMask !== rsMask) {
  errors.push(`脱敏占位文案不一致：TS=${tsMask ?? "<未提取>"} Rust=${rsMask ?? "<未提取>"}`);
}

// Bearer 与 PEM 不是表驱动规则，只能检查两端关键实现是否同时存在；
// 单边把大小写不敏感改回去、或删掉 PEM 标记，都会在这里失败。
const pairedRules = [
  {
    name: "Bearer 大小写不敏感",
    ts: /\/bearer\s+\/gi/.test(ts),
    rs: /to_ascii_lowercase\(\)/.test(rs) && /"bearer "/.test(rs),
  },
  {
    name: "Bearer 最短长度 12",
    ts: /token\.length\s*>=\s*12/.test(ts),
    rs: /token\.len\(\)\s*>=\s*12/.test(rs),
  },
  {
    name: "PEM 私钥标记",
    ts: ts.includes('"-----BEGIN"') && ts.includes('"-----END"'),
    rs: rs.includes('"-----BEGIN"') && rs.includes('"-----END"'),
  },
];
for (const rule of pairedRules) {
  if (rule.ts !== rule.rs) {
    errors.push(`${rule.name}只在一端存在：TS=${rule.ts} Rust=${rule.rs}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`脱敏规则跨端一致：${tsPrefixes.length} 条前缀 + 统一占位文案`);
