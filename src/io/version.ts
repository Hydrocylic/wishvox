// r04 T6（D2）：APP_VERSION 单点——自 io/serialize.ts 拆出。
// 仍读 package.json（Q4 已裁 A：零构建配置、vitest 同路径可测）；爆炸半径收为本文件一处
// ——io 层持版本号属格式关注点，可接受（备选 = vite define 注入，P8 存档轮再议）。
import pkg from '../../package.json'

// appVersion 从 package.json 派生（单一来源，勿在代码里再写一份）
export const APP_VERSION: string = pkg.version
