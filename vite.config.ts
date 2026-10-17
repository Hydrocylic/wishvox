import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// harness/ 下的验证页只走 dev server 直开（如 http://localhost:5173/harness/frame-rate.html），
// 不进 build 产物——dist 保持纯产品形态。
export default defineConfig({
  plugins: [react()],
})
