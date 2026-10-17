// r04 T6（G4）：chunk 实例化重建内核——自 render/voxel-renderer.ts 拆出。
// REQ-024（每 chunk 一个 InstancedMesh）· REQ-025 / I9（脏 chunk 增量重建，读回 = buildSeqSnapshot
// 集合等式——原 rebuiltChunks 计数已删，r04 T7 / §3.1 #13）·
// F3/Q7（层次 = 视图过滤：隐藏层不进实例缓冲 ⇒ 不可拾取）· N2（外观/高亮只重设 instanceColor）。
import * as THREE from 'three'
import { CHUNK_SIZE, chunkKey, decodeLocalIndex } from '../core/coords'
import type { ChunkCoord } from '../core/coords'
import type { LayerFilter } from '../core/brush/predicate'
import { isLayerVisible } from '../core/brush/predicate'
import type { PartRegistry } from '../core/parts'
import type { VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'
import type { Appearance } from './appearance'
import { resolveBlockColor } from './appearance'

const CAPACITY = 4096 // 每 chunk 实例缓冲上限（16³）；count 动态设，容量恒定 ⇒ 重建不 realloc

interface ChunkRecord {
  coord: ChunkCoord
  mesh: THREE.InstancedMesh
  /** instanceId → chunk 内局部下标（按升序填充，拾取时反解世界坐标） */
  cells: number[]
  /** 最近一次实例数据重建的序号（I9 集合等式的读回面：比对前后快照即知"哪些 chunk 被重建"） */
  buildSeq: number
}

/** 拾取面（interaction/pick 的射线目标；结构暴露，不携实现） */
export interface ChunkPickable {
  mesh: THREE.InstancedMesh
  coord: ChunkCoord
  cells: readonly number[]
}

export class ChunkLayer {
  private readonly records = new Map<string, ChunkRecord>()
  private readonly tmpMatrix = new THREE.Matrix4()
  private readonly tmpColor = new THREE.Color()
  private buildSeqCounter = 0
  private unloadedChunks = 0
  private highlightedCount = 0
  private layerFilter: LayerFilter | null = null
  private appearance: Appearance = { style: 'color', missing: new Set() }
  private highlightedPartId: string | null = null
  private highlightedCoords: Set<string> | null = null

  constructor(
    private readonly scene: THREE.Scene,
    private readonly volume: Volume,
    private readonly parts: PartRegistry | null,
    private readonly geometry: THREE.BoxGeometry,
    private readonly material: THREE.Material,
  ) {}

  get unloadedChunkCount(): number {
    return this.unloadedChunks
  }

  get residentCount(): number {
    return this.records.size
  }

  get highlightedCellCount(): number {
    return this.highlightedCount
  }

  get visibleInstanceCount(): number {
    let visible = 0
    for (const rec of this.records.values()) visible += rec.mesh.count
    return visible
  }

  /** F3 读回面（debug-261007）：当前实际持有的层次过滤（重建时逐格过 isLayerVisible 的那一份） */
  get filter(): LayerFilter | null {
    return this.layerFilter
  }

  /** F3：层次过滤（below = minY..y；single = 只 y 层）。视图驱动重建（同由 buildSeq 快照读回）。 */
  setFilter(filter: LayerFilter | null): void {
    this.layerFilter = filter
    for (const coord of [...this.records.keys()].map(parseChunkKey)) this.rebuildChunk(coord)
  }

  /** 增量重建（REQ-025 / I9：重建集合 = 受影响 chunk 集合，读回走 buildSeqSnapshot 集合等式）；
   *  被清空的 chunk 对账卸载（T15 防幽灵块） */
  applyChanges(changes: readonly VoxelChange[]): void {
    const affected = new Map<string, ChunkCoord>()
    for (const c of changes) {
      for (const coord of this.volume.affectedResidentChunks(c.x, c.y, c.z)) {
        affected.set(chunkKey(coord.cx, coord.cy, coord.cz), coord)
      }
    }
    for (const coord of affected.values()) this.rebuildChunk(coord)
    this.unloadStaleChunks()
  }

  /** 全量重建（初始化 / 导入 / 回退后）——同样计入 buildSeq 快照（与增量路径共用集合等式读回） */
  rebuildAll(): void {
    const live = new Set<string>()
    for (const chunk of this.volume.iterChunks()) {
      const coord: ChunkCoord = { cx: chunk.cx, cy: chunk.cy, cz: chunk.cz }
      this.rebuildChunk(coord)
      live.add(chunkKey(chunk.cx, chunk.cy, chunk.cz))
    }
    for (const [key, rec] of [...this.records.entries()]) {
      if (!live.has(key)) {
        this.scene.remove(rec.mesh)
        rec.mesh.dispose()
        this.records.delete(key)
      }
    }
  }

  setAppearance(app: Appearance): void {
    this.appearance = { ...app, missing: new Set(app.missing) }
    this.refreshColors()
  }

  setHighlightedPart(partId: string | null): void {
    this.highlightedPartId = partId
    this.highlightedCoords = null
    this.refreshColors()
  }

  /** r02：组合高亮（REQ-051 ②）——组合不是 part，高亮集合 = resolveScope 解析出的坐标键集合。
   *  只影响 instanceColor（与 setHighlightedPart 同层），不触碰 chunk 重建路径。 */
  setHighlightedCoords(coordKeys: ReadonlySet<string> | null): void {
    this.highlightedCoords = coordKeys === null ? null : new Set(coordKeys)
    this.highlightedPartId = null
    this.refreshColors()
  }

  /** 只重设 instanceColor（N2：切贴图源后重建 chunk 集合 = 空的实现基础） */
  refreshColors(): void {
    let highlighted = 0
    for (const rec of this.records.values()) {
      const chunk = this.volume.getChunk(rec.coord.cx, rec.coord.cy, rec.coord.cz)
      if (!chunk) continue
      const ox = rec.coord.cx * CHUNK_SIZE
      const oy = rec.coord.cy * CHUNK_SIZE
      const oz = rec.coord.cz * CHUNK_SIZE
      for (let i = 0; i < rec.cells.length; i++) {
        const { lx, ly, lz } = decodeLocalIndex(rec.cells[i]!)
        const hex = this.cellColor(ox + lx, oy + ly, oz + lz, chunk.data[rec.cells[i]!])
        if (this.isHighlighted(ox + lx, oy + ly, oz + lz)) highlighted++
        rec.mesh.setColorAt(i, this.tmpColor.set(hex))
      }
      if (rec.mesh.instanceColor) rec.mesh.instanceColor.needsUpdate = true
    }
    this.highlightedCount = highlighted
  }

  /** 驻留 chunk → buildSeq 快照（harness 取前后两份做差 = "本次哪些 chunk 的实例数据被重建"） */
  buildSeqSnapshot(): Map<string, number> {
    const snapshot = new Map<string, number>()
    for (const [key, rec] of this.records) snapshot.set(key, rec.buildSeq)
    return snapshot
  }

  /** 拾取面（射线目标 = 各 chunk 的 InstancedMesh） */
  pickables(): ChunkPickable[] {
    return [...this.records.values()]
  }

  countNaN(): number {
    let nan = 0
    for (const rec of this.records.values()) {
      const arr = rec.mesh.instanceMatrix.array
      const n = rec.mesh.count * 16
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(arr[i])) nan++
      }
    }
    return nan
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      this.scene.remove(rec.mesh)
      rec.mesh.dispose()
    }
    this.records.clear()
  }

  // ── 内部 ──

  // T15：`affectedResidentChunks` 按"改动后驻留"取集合 ⇒ 被清空的 chunk 不在影响集合、
  // 永远等不到 rebuildChunk ⇒ mesh 残留成幽灵块。这里对账"records − 模型驻留"，多则卸载。
  private unloadStaleChunks(): void {
    for (const [key, rec] of [...this.records.entries()]) {
      const chunk = this.volume.getChunk(rec.coord.cx, rec.coord.cy, rec.coord.cz)
      if (chunk && chunk.nonEmpty > 0) continue
      this.scene.remove(rec.mesh)
      rec.mesh.dispose()
      this.records.delete(key)
      this.unloadedChunks += 1
    }
  }

  private rebuildChunk(coord: ChunkCoord): void {
    const key = chunkKey(coord.cx, coord.cy, coord.cz)
    const chunk = this.volume.getChunk(coord.cx, coord.cy, coord.cz)
    if (!chunk || chunk.nonEmpty === 0) {
      const rec = this.records.get(key)
      if (rec) {
        this.scene.remove(rec.mesh)
        rec.mesh.dispose()
        this.records.delete(key)
      }
      return
    }
    let rec = this.records.get(key)
    if (!rec) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.scene.add(mesh)
      rec = { coord, mesh, cells: [], buildSeq: 0 }
      this.records.set(key, rec)
    }
    const ox = coord.cx * CHUNK_SIZE
    const oy = coord.cy * CHUNK_SIZE
    const oz = coord.cz * CHUNK_SIZE
    let i = 0
    rec.cells.length = 0
    for (let idx = 0; idx < CAPACITY; idx++) {
      const keyNum = chunk.data[idx]
      if (keyNum === 0) continue
      const { lx, ly, lz } = decodeLocalIndex(idx)
      // F3/Q7：层次 = 视图过滤——隐藏层的块不进实例缓冲 ⇒ 拾取射线天然打不到（不可拾取、无预览）
      if (!isLayerVisible(this.layerFilter, oy + ly)) continue
      this.tmpMatrix.makeTranslation(ox + lx + 0.5, oy + ly + 0.5, oz + lz + 0.5)
      rec.mesh.setMatrixAt(i, this.tmpMatrix)
      rec.mesh.setColorAt(i, this.tmpColor.set(this.cellColor(ox + lx, oy + ly, oz + lz, keyNum)))
      rec.cells.push(idx)
      i++
    }
    rec.mesh.count = i
    rec.mesh.instanceMatrix.needsUpdate = true
    if (rec.mesh.instanceColor) rec.mesh.instanceColor.needsUpdate = true
    rec.mesh.computeBoundingSphere()
    rec.buildSeq = ++this.buildSeqCounter
  }

  private cellColor(x: number, y: number, z: number, key: number): string {
    const entry = this.volume.palette.get(key)
    return resolveBlockColor(
      entry?.identity,
      entry?.color,
      this.appearance,
      this.isHighlighted(x, y, z),
    )
  }

  private isHighlighted(x: number, y: number, z: number): boolean {
    if (this.highlightedCoords !== null) return this.highlightedCoords.has(`${x},${y},${z}`)
    return this.parts !== null && this.highlightedPartId !== null && this.parts.partIdOf(x, y, z) === this.highlightedPartId
  }
}

function parseChunkKey(key: string): ChunkCoord {
  const [cx, cy, cz] = key.split(',').map(Number)
  return { cx, cy, cz }
}
