import { resolve } from "node:path";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? (repositoryName ? `/${repositoryName}/` : "/"),
  // 界面测试可以把 PUBLIC_DIR 指向独立夹具目录（如 fixtures/public），正式内容目录保持不变。
  publicDir: process.env.PUBLIC_DIR ? resolve(process.env.PUBLIC_DIR) : "public",
});
