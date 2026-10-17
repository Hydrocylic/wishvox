import { beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { applyBrush } from '../../src/core/brush/apply'
import { brushPreviewState } from '../../src/edit/stroke'

beforeEach(() => setUi({ mode: 'edit', tool: 'place', layerMode: 'all', layerY: 0, workGridY: 0, gridLayer: false, gridBase: false,
  currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, overridePlace: false, previewReadout: null }))
describe('P2 editing contract', () => {
  it('REQ-052 all keeps higher/lower additions visible; below/single do not follow growth', () => {
    const ed = new Editor(new MemoryProjectStore())
    ed.place(0,0,0)
    ed.setLayerView('all',0)
    ed.place(0,-3,0)
    ed.place(0,4,0)
    expect(ed.currentLayerFilter()).toBeNull()
    expect(useEditorUi.getState()).toMatchObject({ layerMinY: -3, layerMaxY: 4, layerY: 0 })
    ed.setLayerView('below', 0)
    ed.aiSetCells({ cells: [{ x: 0,y: 5,z: 0,key: 1 }] })
    expect(ed.currentLayerFilter()).toEqual({ mode: 'below',y: 0 })
    ed.setLayerView('single',0)
    ed.aiSetCells({ cells: [{ x: 0,y: -4,z: 0,key: 1 }] })
    expect(ed.currentLayerFilter()).toEqual({ mode: 'single',y: 0 })
  })
  it('A-04 hidden targets have no preview/writes/history and report reason', () => {
    const ed = new Editor(new MemoryProjectStore())
    ed.place(0,-1,0)
    ed.setLayerView('single',0)
    const before = [...ed.volume.iterBlocks()]
    const history = ed.log.patches.length
    for (const tool of ['place','erase','paint'] as const) {
      ed.setTool(tool)
      expect(ed.previewAt({x:0,y:-1,z:0})).toEqual([])
      ed.strokeBegin()
      expect(ed.strokeApply({x:0,y:-1,z:0})).toBe(0)
      ed.strokeCommit()
      expect(useEditorUi.getState().message).toContain('隐藏')
    }
    expect([...ed.volume.iterBlocks()]).toEqual(before)
    expect(ed.log.patches.length).toBe(history)
  })
  it('A-06 independent grid leaves model, filter and history intact; rejects illegal y', () => {
    const ed = new Editor(new MemoryProjectStore())
    for (let y=-3;y<=4;y++) if (y !== 1) ed.place(0,y,0)
    ed.setLayerView('single',0)
    const before = [...ed.volume.iterBlocks()]
    const history = ed.log.patches.length
    ed.setGridView(false,true)
    ed.setWorkGridY(-2)
    expect(useEditorUi.getState()).toMatchObject({ workGridY: -2,layerMinY: -3,layerMaxY: 4,layerY:0,layerMode:'single' })
    expect(useEditorUi.getState().perLayerCounts.find(c => c.y === 1)?.count ?? 0).toBe(0)
    for (const y of [NaN,Infinity,.5,4097,-4097]) ed.setWorkGridY(y)
    expect(useEditorUi.getState().workGridY).toBe(-2)
    expect([...ed.volume.iterBlocks()]).toEqual(before)
    expect(ed.log.patches.length).toBe(history)
    ed.setLayerView('all',0)
    expect(useEditorUi.getState().workGridY).toBe(-2)
  })
  it('A-02 preview equals actual differences including same-color and domain clipping', () => {
    const ed = new Editor(new MemoryProjectStore())
    ed.volume.setBlock(4096,0,0,1)
    const size = {x:2,y:1,z:1}, anchor = {x:4096,y:0,z:0}
    for (const action of ['place','erase','paint'] as const) for (const key of [1,2]) {
      const actual = applyBrush(ed.volume,{size,anchor,action,key,mode:'override'},null).changes
      const preview = brushPreviewState(ed.volume,size,anchor,action,true,null,key)
      expect(preview.cells).toEqual(actual.map(({x,y,z})=>({x,y,z})))
    }
  })
})
