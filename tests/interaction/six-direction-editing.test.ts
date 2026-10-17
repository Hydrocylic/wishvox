import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Volume } from '../../src/core/volume'
import { pickAt } from '../../src/interaction/pick'
import { pickGroundCell } from '../../src/interaction/ground-pick'
import { applyBrush } from '../../src/core/brush/apply'
import { brushPreviewState } from '../../src/edit/stroke'

const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } as HTMLElement
const size = { x: 1, y: 1, z: 1 }
const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const
function fixture(direction: readonly number[]) {
  const volume = new Volume()
  volume.palette.intern('red', {}, '#ff0000')
  volume.palette.intern('blue', {}, '#0000ff')
  volume.setBlock(0, 0, 0, 1)
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial(), 1)
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(.5,.5,.5))
  mesh.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100)
  camera.position.set(.5 + direction[0]*5, .5 + direction[1]*5, .5 + direction[2]*5)
  if (direction[1]) camera.up.set(0,0,1)
  camera.lookAt(.5,.5,.5)
  camera.updateMatrixWorld(true)
  const pickables = [{ mesh, coord: { cx: 0, cy: 0, cz: 0 }, cells: [0] }]
  return { volume, camera, pickables }
}
describe('P2 six-direction picking（D2 起 = 最近者优先；A-01 六向锚点面不变）', () => {
  for (const d of directions) it(`A-01 face ${d}: adjacent place / body erase and paint`, () => {
    const { volume, camera, pickables } = fixture(d)
    const hit = pickAt(canvas, camera, pickables, volume, 50, 50)!
    expect(hit.source).toBe('model')
    expect(hit.cell).toEqual([0,0,0])
    expect(hit.adjacent).toEqual(d)
    for (const action of ['place','erase','paint'] as const) {
      const [x,y,z] = action === 'place' ? hit.adjacent : hit.cell
      const anchor = { x,y,z }
      const result = applyBrush(volume, { size, anchor, action, mode: 'additive', key: 2 }, null)
      expect(result.changes).toHaveLength(1)
      expect(result.changes[0]).toMatchObject({ x,y,z, after: action === 'erase' ? 0 : 2 })
      expect(brushPreviewState(volume,size,anchor,action,false,null,2).cells).toEqual([{x,y,z}])
      expect([...volume.iterBlocks()]).toHaveLength(1)
      expect(volume.getBlock(0,0,0)).toBe(1)
    }
  })
  // `D2`（design §8，2026-10-16 用户批准）**取代** `U3` 的"同时命中模型优先"字面：
  // 沿射线取**更近者**——网格面更近 ⇒ 网格优先；模型面更近 ⇒ 模型优先；**等距 ⇒ 模型优先**（稳定可复现）。
  // 相机在 (0.5,5.5,0.5) 俯视：模型顶面 y=1（距离 4.5）· 平面 y=2（距离 3.5）· 平面 y=1（距离 4.5，等距）。
  for (const [y, source] of [[2, 'plane'], [1, 'model'], [0.5, 'model'], [-2, 'model']] as const) {
    it(`D2 最近者优先：平面 y=${y} ⇒ ${source}`, () => {
      const { volume, camera, pickables } = fixture([0, 1, 0])
      expect(pickAt(canvas, camera, pickables, volume, 50, 50, y)?.source).toBe(source)
    })
  }
  it('D2 网格面更近时放置锚点 = 网格平面 y=workGridY 对应格（不落到模型面）', () => {
    const { volume, camera, pickables } = fixture([0, 1, 0])
    const hit = pickAt(canvas, camera, pickables, volume, 50, 50, 2)!
    expect(hit.source).toBe('plane')
    expect(hit.cell).toEqual([0, 2, 0])
    expect(hit.adjacent).toEqual([0, 2, 0])
  })
  it('D2 预览与实际差分一致：最近者优先选出的锚点，预览集合 = 落笔变更集合', () => {
    const { volume, camera, pickables } = fixture([0, 1, 0])
    const hit = pickAt(canvas, camera, pickables, volume, 50, 50, 2)!
    const anchor = { x: hit.adjacent[0], y: hit.adjacent[1], z: hit.adjacent[2] }
    const preview = brushPreviewState(volume, size, anchor, 'place', false, null, 2)
    const actual = applyBrush(volume, { size, anchor, action: 'place', mode: 'additive', key: 2 }, null)
    expect(preview.cells).toEqual(actual.changes.map((c) => ({ x: c.x, y: c.y, z: c.z })))
    expect(preview.cells).toEqual([{ x: 0, y: 2, z: 0 }])
    // 对照：模型优先那一侧（平面更远）同样"预览 = 实际"
    const near = pickAt(canvas, camera, pickables, volume, 50, 50, -2)!
    expect(near.source).toBe('model')
    const anchor2 = { x: near.adjacent[0], y: near.adjacent[1], z: near.adjacent[2] }
    expect(brushPreviewState(volume, size, anchor2, 'place', false, null, 2).cells).toEqual(
      applyBrush(volume, { size, anchor: anchor2, action: 'place', mode: 'additive', key: 2 }, null).changes.map((c) => ({ x: c.x, y: c.y, z: c.z })),
    )
  })
  it('D2 从下方观察：模型底面比网格面更近 ⇒ 命中底面并向下放置（y<h）', () => {
    const { volume, camera, pickables } = fixture([0, -1, 0]) // 相机在下方仰视
    const hit = pickAt(canvas, camera, pickables, volume, 50, 50, 2)!
    expect(hit.source).toBe('model')
    expect(hit.cell).toEqual([0, 0, 0])
    expect(hit.adjacent).toEqual([0, -1, 0]) // 向下放置仍可绕到底部
  })
  it('A-03 no implicit plane; explicit plane gives a distinct source', () => {
    const { volume,camera } = fixture([0,1,0])
    expect(pickAt(canvas,camera,[],volume,50,50)).toBeNull()
    expect(pickAt(canvas,camera,[],volume,50,50,-2)).toMatchObject({ source: 'plane', cell: [0,-2,0] })
  })
  it('A-05 plane from both sides uses same y, parallel/backward/invalid rejected', () => {
    expect(pickGroundCell([.5,3,.5],[0,-1,0],-1)).toEqual([0,-1,0])
    expect(pickGroundCell([.5,-3,.5],[0,1,0],-1)).toEqual([0,-1,0])
    expect(pickGroundCell([0,3,0],[1,0,0],-1)).toBeNull()
    expect(pickGroundCell([0,3,0],[0,1,0],-1)).toBeNull()
    expect(pickGroundCell([NaN,3,0],[0,-1,0],-1)).toBeNull()
    expect(pickGroundCell([0,3,0],[0,-1,0],.5)).toBeNull()
    expect(pickGroundCell([4097,3,0],[0,-1,0],0)).toBeNull()
  })
})
