import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewportHud } from '../../src/ui/ViewportHud'
import { useEditorUi } from '../../src/state/editor-store'

it('B2 HUD 预留六行及全部间距：进出视口和警告切换不改变最坏高度预算', () => {
  const before = useEditorUi.getState()
  try {
    for (const active of [false, true, false]) {
      useEditorUi.setState({
        previewReadout: active ? { size: [1, 1, 1], anchor: [0, 0, 0], cells: 1 } : null,
        previewReject: active ? { seq: 1, text: '无有效格' } as typeof before.previewReject : null,
      })
      const html = renderToStaticMarkup(createElement(ViewportHud))
      expect(html).toContain('min-height:149px')
      expect(html).toContain('box-sizing:border-box')
      expect(html).toContain('white-space:pre')
    }
  } finally { useEditorUi.setState(before) }
})
