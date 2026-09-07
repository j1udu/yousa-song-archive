import { resolve } from "node:path";
import { writeWorkIndex } from "./content-lib";

// 可选参数：内容根目录（默认当前目录），用于生成独立测试夹具的索引，例如 `tsx scripts/generate-content.ts fixtures`。
const root = resolve(process.argv[2] ?? process.cwd());

try {
  const index = writeWorkIndex(root);
  console.log(`内容索引已生成：${index.works.length} 个作品`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
