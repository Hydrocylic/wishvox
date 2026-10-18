import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 本仓未装 `@types/node`（vite.config.ts 由 tsconfig.node 编译）：只声明这里用到的最小 `process.env`，
// 不引依赖、不影响运行时（Node 里全局 `process` 本来就在）。
declare const process: { env: Record<string, string | undefined> }

// harness/ 下的验证页只走 dev server 直开（如 http://localhost:5173/harness/frame-rate.html），
// 不进 build 产物——dist 保持纯产品形态。
export default defineConfig({
  plugins: [react()],
  // 只有 GitHub Actions 构建走项目页子路径 `/wishvox/`（`https://hydrocylic.github.io/wishvox/`）；
  // 本地 dev / vitest / 普通 build 仍是根路径 `/` ⇒ clone 后 `npm run dev` 不受影响。
  base: process.env.GITHUB_ACTIONS ? '/wishvox/' : '/',
})
