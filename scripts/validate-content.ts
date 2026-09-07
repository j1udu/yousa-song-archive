import { resolve } from "node:path";
import { buildWorkIndex } from "./content-lib";

// 可选参数：内容根目录（默认当前目录），例如 `tsx scripts/validate-content.ts fixtures`。
const root = resolve(process.argv[2] ?? process.cwd());

try {
  const { index } = buildWorkIndex(root);
  console.log(`内容校验通过：${index.works.length} 个作品`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
