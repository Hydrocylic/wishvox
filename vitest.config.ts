import { defineConfig } from 'vitest/config'

// L1 无头单测：纯逻辑（src/core 一类），不起 DOM、不吃 GPU——对齐笔记库 curriculum/testing-plan.md 的 L1 定义。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
