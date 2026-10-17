/**
 * Layer-order / size / wiring constraints for the r04 layout (restructure-design.md §1.0 / §1.1-K).
 *
 * Derived from PetitMaker's `src/__tests__/import-direction.test.ts`
 * (https://github.com/Stry233/PetitMaker.git — pin 4e120e5, Apache License 2.0, Copyright PetitMaker contributors):
 * "modified from PetitMaker (Apache-2.0, pin 4e120e5)". Kept from upstream: the LAYERS rank
 * table + ALLOWED_UPWARD shape, the type-only exemption (type-only statements are erased at
 * compile time — a contract, not runtime coupling), and the import-extraction regexes.
 * Added for our layout: the acyclicity check (Tarjan, runtime edges), the ≤400-line rule with
 * its single whitelisted file (Q3), the no-ai→ui check, the composition-root lexical rules (G2⑤)
 * and the render-paints-only rules (G2⑥).
 */
import { describe, expect, it } from 'vitest'

const modules = import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Bottom to top. A layer may import from itself and anything earlier.
 *  `app` is the composition root (assembly only); `ui` reaches it through service location —
 *  the single allowed upward edge (Q2, 2026-10-06). */
const LAYERS = [
  ['core'],
  ['ops', 'rules', 'io'],
  ['state'],
  ['edit'],
  ['render', 'interaction'],
  ['ai'],
  ['ui'],
  ['app'],
] as const
type Layer = (typeof LAYERS)[number][number]

const RANK = new Map<Layer, number>(LAYERS.flatMap((group, i) => group.map((l): [Layer, number] => [l, i])))

/** Edges that point up and are accepted, as `importer layer -> imported path prefix`.
 *  The single entry is the sanctioned service-location edge (Q2); adding a line here needs the
 *  same argument that moving the module would. */
const ALLOWED_UPWARD: ReadonlyArray<readonly [Layer, string]> = [['ui', 'app/']]

/** G2③ (Q3): files known to exceed 400 lines and accepted (recorded, not silently passed). */
const LINE_WHITELIST = ['core/patch-log.ts']
const MAX_LINES = 400

/** Type-only statements are erased at compile time: they express a contract, not runtime coupling
 *  (upstream exemption, see header). They are therefore not edges for the rank test ① nor for the
 *  cycle test ②. Assertions ④/⑥ deliberately scan EVERY import line, type-only included. */
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\s/
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

interface Edge {
  file: string
  layer: Layer
  target: string
  targetLayer: Layer
}

function srcPath(globKey: string): string {
  return globKey.replace('../../src/', '').replace(/\\/g, '/')
}

function layerOf(srcRelative: string): Layer | null {
  const top = srcRelative.split('/')[0] as Layer
  return RANK.has(top) ? top : null
}

/** A specifier's src-relative path, or null when it names something outside `src/` (a package). */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = fromFile.slice(0, fromFile.lastIndexOf('/'))
  const segments = (base ? base.split('/') : []).concat(spec.split('/'))
  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') resolved.pop()
    else resolved.push(seg)
  }
  const noExt = resolved.join('/')
  const candidates = [`${noExt}.ts`, `${noExt}.tsx`, `${noExt}/index.ts`]
  return candidates.find((c) => modules[`../../src/${c}`] !== undefined) ?? null
}

/** Runtime edges (type-only lines dropped). */
function runtimeEdges(): Edge[] {
  const edges: Edge[] = []
  for (const [key, text] of Object.entries(modules)) {
    const srcRel = srcPath(key)
    const layer = layerOf(srcRel)
    if (!layer) continue
    const runtimeText = text
      .split('\n')
      .filter((line) => !TYPE_ONLY_RE.test(line))
      .join('\n')
    for (const m of runtimeText.matchAll(IMPORT_RE)) {
      const resolved = resolveSpec(srcRel, m[1]!)
      if (resolved === null) continue
      const targetLayer = layerOf(resolved)
      if (!targetLayer) continue
      edges.push({ file: srcRel, layer, target: resolved, targetLayer })
    }
  }
  return edges
}

const isAllowed = (e: Edge): boolean =>
  ALLOWED_UPWARD.some(([layer, prefix]) => e.layer === layer && e.target.startsWith(prefix))

describe('G2-层序：imports point downward', () => {
  it('no source file imports from a layer above its own (whitelist = ui -> app only)', () => {
    const offenders = runtimeEdges().filter((e) => RANK.get(e.targetLayer)! > RANK.get(e.layer)! && !isAllowed(e))
    expect(offenders.map((e) => `${e.file} (${e.layer}) -> ${e.target} (${e.targetLayer})`)).toEqual([])
  })
})

describe('G2-无环（Tarjan SCC，runtime edges）', () => {
  it('the runtime import graph has no strongly connected component larger than one file', () => {
    const graph = new Map<string, string[]>()
    for (const key of Object.keys(modules)) graph.set(srcPath(key), [])
    for (const e of runtimeEdges()) graph.get(e.file)!.push(e.target)
    // Tarjan
    let index = 0
    const indices = new Map<string, number>()
    const low = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const biggestScc: string[] = []
    const strongconnect = (v: string): void => {
      indices.set(v, index)
      low.set(v, index)
      index++
      stack.push(v)
      onStack.add(v)
      for (const w of graph.get(v) ?? []) {
        if (!indices.has(w)) {
          strongconnect(w)
          low.set(v, Math.min(low.get(v)!, low.get(w)!))
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, indices.get(w)!))
        }
      }
      if (low.get(v) === indices.get(v)) {
        const scc: string[] = []
        for (;;) {
          const w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
          if (w === v) break
        }
        if (scc.length > biggestScc.length) biggestScc.push(...scc)
      }
    }
    for (const v of graph.keys()) if (!indices.has(v)) strongconnect(v)
    expect(biggestScc.length).toBeLessThanOrEqual(1)
  })
})

describe('G2-≤400行（wc -l 口径；白名单唯一 = core/patch-log.ts，Q3）', () => {
  it('every src file is within the limit or whitelisted', () => {
    const offenders: string[] = []
    for (const [key, text] of Object.entries(modules)) {
      const srcRel = srcPath(key)
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      if (lines > MAX_LINES && !LINE_WHITELIST.includes(srcRel)) offenders.push(`${srcRel}: ${lines}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('G2-无ai→ui 反向依赖（含 type-only 行）', () => {
  it('no file under src/ai imports anything from src/ui', () => {
    const offenders: string[] = []
    for (const [key, text] of Object.entries(modules)) {
      const srcRel = srcPath(key)
      if (!srcRel.startsWith('ai/')) continue
      for (const m of text.matchAll(IMPORT_RE)) {
        const resolved = resolveSpec(srcRel, m[1]!)
        if (resolved !== null && resolved.startsWith('ui/')) offenders.push(`${srcRel} -> ${resolved}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('G2-组合根（词法判据）', () => {
  it('no exported module-load singletons, and src/ui never constructs Editor / AgentSession', () => {
    const offenders: string[] = []
    for (const [key, text] of Object.entries(modules)) {
      const srcRel = srcPath(key)
      if (/export const \w+ = new (Editor|AgentSession)\(/.test(text)) offenders.push(`${srcRel}: exported singleton construction`)
      if (srcRel.startsWith('ui/') && /new (Editor|AgentSession)\(/.test(text)) offenders.push(`${srcRel}: ui constructs Editor/AgentSession`)
    }
    expect(offenders).toEqual([])
  })
})

describe('G2-render只管画（词法 + 方向）', () => {
  it('render/** imports neither interaction/** nor OrbitControls', () => {
    const offenders: string[] = []
    for (const [key, text] of Object.entries(modules)) {
      const srcRel = srcPath(key)
      if (!srcRel.startsWith('render/')) continue
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1]!
        const resolved = resolveSpec(srcRel, spec)
        if (resolved !== null && resolved.startsWith('interaction/')) offenders.push(`${srcRel} -> ${resolved}`)
        if (spec.includes('OrbitControls')) offenders.push(`${srcRel} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
