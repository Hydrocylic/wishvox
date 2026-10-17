// r04 T6（G1）：拾取编排——自 render/voxel-renderer.ts 的 pick() 拆出（拾取是交互关注点）。
// 地面落格规则在同层 ground-pick.ts（纯函数）；射线目标 = render/chunks 的 pickables（结构类型）。
import * as THREE from 'three'
import { CHUNK_SIZE, decodeLocalIndex } from '../core/coords'
import type { Volume } from '../core/volume'
import type { ChunkPickable } from '../render/chunks'
import { pickGroundCellWithDistance } from './ground-pick'

export interface PickResult {
  cell: [number, number, number]
  adjacent: [number, number, number]
  key: number
  source: 'model' | 'plane'
}

/** 拾取：**最近者优先**（`D2`，2026-10-16 裁定；改变 `U3` 的"同时命中模型优先"字面）。
 *  - 调用方给了 `planeY`（编辑/放置 + 工作网格开启）⇒ 同时算**工作网格面**与**最近可见模型面**，
 *    取沿射线**更靠近相机**者：网格面更近 ⇒ 网格优先（落格 = 该平面 `y=planeY` 对应的格）；模型面更近 ⇒ 模型优先；
 *  - **距离相等 ⇒ 模型优先**（理论退化，取稳定可复现的一侧，避免抖动）；
 *  - 模型未命中且给了 `planeY` ⇒ 只走网格面；网格面未命中（背向 / 平行 / 落格越界）⇒ 只走模型；
 *  - `planeY === null`（默认：网格关 / 非放置工具 / 检视态）⇒ 完全维持旧口径，**不引入网格面命中**。
 *  “从下方/侧向仍能绕到底部”由此自然保留：底面比网格面更近时命中底面，相邻格 = y<h。 */
export function pickAt(
  canvas: HTMLElement,
  camera: THREE.PerspectiveCamera,
  pickables: readonly ChunkPickable[],
  volume: Volume,
  clientX: number,
  clientY: number,
  planeY: number | null = null,
): PickResult | null {
  const rect = canvas.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(
    pickables.map((r) => r.mesh),
    false,
  )
  const hit = hits[0]
  const ground =
    planeY === null
      ? null
      : pickGroundCellWithDistance(
          [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
          [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
          planeY,
        )
  const planeResult = (): PickResult | null =>
    ground === null
      ? null
      : { cell: ground.cell, adjacent: ground.cell, key: volume.getBlock(ground.cell[0], ground.cell[1], ground.cell[2]), source: 'plane' }
  if (!hit || hit.instanceId === undefined || !hit.face) {
    return planeResult()
  }
  // `D2`：网格面严格更近才算网格优先；等距（含浮点退化）取模型优先。
  if (ground !== null && ground.distance < hit.distance) return planeResult()
  let target: ChunkPickable | undefined
  for (const r of pickables) {
    if (r.mesh === hit.object) {
      target = r
      break
    }
  }
  if (!target) return null
  const localIdx = target.cells[hit.instanceId]
  if (localIdx === undefined) return null
  const { lx, ly, lz } = decodeLocalIndex(localIdx)
  const cell: [number, number, number] = [
    target.coord.cx * CHUNK_SIZE + lx,
    target.coord.cy * CHUNK_SIZE + ly,
    target.coord.cz * CHUNK_SIZE + lz,
  ]
  const n = hit.face.normal
  const adjacent: [number, number, number] = [
    cell[0] + Math.round(n.x),
    cell[1] + Math.round(n.y),
    cell[2] + Math.round(n.z),
  ]
  return { cell, adjacent, key: volume.getBlock(cell[0], cell[1], cell[2]), source: 'model' }
}
