import { useCallback, useEffect, useRef, useState } from 'react'
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js'
import { COLS, ROWS, type Atom, type Line } from './typeset'
import { buildDocument } from './content'

export const FLIP_MS = 800

/**
 * 稿纸上的字是命令式写进去的，不走 React 渲染。三个原因：
 *   1. StPageFlip 会把 .page 元素搬进自己造的容器、逐帧改 cssText，React 管不了；
 *   2. 打字机每 34ms 落一个字，用 state 驱动就是几百次全树重渲染；
 *   3. 称呼和署名是 contentEditable，受控组件会跟输入法和光标打架。
 * 所以这个 hook 负责整块「书」，只把外面要用的状态（页码、是否写完、勾了几条）交回 React。
 */
export interface LetterBook {
  pageCount: number
  cursor: number
  /** 正文是否还在书写 */
  typing: boolean
  /** 已勾选的整改措施条数 */
  doneMeasures: number
  prev: () => void
  next: () => void
  turnToPage: (page: number) => void
  /** 往稿纸上追加第 index 条附言（0 起） */
  appendPs: (index: number) => Promise<void>
}

interface Refs {
  book: React.RefObject<HTMLDivElement | null>
  /** 一个隐藏的 var(--cell) 见方的探针，用来量当前一格有多少像素 */
  probe: React.RefObject<HTMLDivElement | null>
  /** 抬头区域，宽度要跟书对齐 */
  head: React.RefObject<HTMLDivElement | null>
  /** 落款日期用的时刻，由页面持有以保证渲染间稳定 */
  now: Date
}

export function useLetterBook({ book, probe, head, now }: Refs): LetterBook {
  const [pageCount, setPageCount] = useState(1)
  const [cursor, setCursor] = useState(0)
  const [typing, setTyping] = useState(true)
  const [doneMeasures, setDoneMeasures] = useState(0)

  // 命令式那一侧的入口，effect 里填好，React 这边通过稳定的包装函数调用
  const api = useRef<{
    prev: () => void
    next: () => void
    turnToPage: (page: number) => void
    appendPs: (index: number) => Promise<void>
  }>({
    prev: () => {},
    next: () => {},
    turnToPage: () => {},
    appendPs: async () => {},
  })

  useEffect(() => {
    const bookEl = book.current
    const probeEl = probe.current
    const headEl = head.current
    if (!bookEl || !probeEl || !headEl) return

    let disposed = false
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches

    const { docLines, psLines, pageCount: pages } = buildDocument(now)
    setPageCount(pages)

    /* ---------- 造页 ---------- */
    // 这些 DOM 由我们自己建、自己拆，React 不碰 bookEl 的子节点
    let inner = document.createElement('div')
    bookEl.appendChild(inner)

    const sheets: HTMLElement[] = []
    for (let i = 0; i < pages; i++) {
      const page = document.createElement('div')
      page.className = 'page'
      page.innerHTML = '<div class="page-inner"><div class="sheet"></div></div>'
      inner.appendChild(page)
      sheets.push(page.querySelector('.sheet')!)
    }

    /* ---------- 起书 ---------- */
    let flip: PageFlip | null = null
    let cur = 0

    const moveCursor = (n: number) => {
      cur = n
      if (!disposed) setCursor(n)
    }

    const cellPx = () => probeEl.getBoundingClientRect().width
    const bookSize = () => {
      const c = cellPx()
      return { w: Math.round(c * (COLS + 1)), h: Math.round(c * ROWS) }
    }
    let size = bookSize()

    const buildBook = (startPage: number) => {
      size = bookSize()
      headEl.style.width = size.w + 'px'
      flip = new PageFlip(inner, {
        width: size.w,
        height: size.h,
        size: 'fixed',
        usePortrait: true,
        showCover: false,
        autoSize: true,
        drawShadow: true,
        maxShadowOpacity: 0.42,
        flippingTime: FLIP_MS,
        useMouseEvents: false, // 只用按钮翻，免得点稿纸误触
        // disableFlipByClick 必须保持 false：库的 flipPrev() 传的是没加 left 偏移的
        // 裸坐标，开了这个开关会被 isPointOnCorners 拦掉，导致「上一页」失灵
        disableFlipByClick: false,
        mobileScrollSupport: true,
        swipeDistance: 10000, // 关掉滑动
      })
      flip.loadFromHTML(inner.querySelectorAll('.page'))
      flip.on('flip', (e) => moveCursor(e.data as number))
      if (startPage) flip.turnToPage(startPage)
      moveCursor(flip.getCurrentPageIndex())
    }

    /**
     * 库的 destroy() 不会停掉 render.start() 里那个自我调度的 requestAnimationFrame。
     * 循环活着就会继续把不在当前跨页上的 .page 设成 display:none，跟新实例抢同一批
     * 元素。库没给停止的接口，只能把 drawFrame 换成空函数，等价于让循环空转。
     */
    const teardownFlip = () => {
      if (!flip) return
      const render = flip.getRender() as { drawFrame: () => void }
      render.drawFrame = () => {}
      // destroy() 里的 block.remove() 会把传进去的容器一并删掉，所以传的是我们自己
      // 造的 inner，而不是 React 渲染的 bookEl
      try {
        flip.destroy()
      } catch {
        /* 拆到一半失败也无所谓，下面会重建 */
      }
      flip = null
    }

    const rebuild = (keep: number) => {
      const pageEls = [...inner.querySelectorAll('.page')] as HTMLElement[]
      pageEls.forEach((p) => bookEl.appendChild(p)) // 先寄存，别被 destroy 带走
      teardownFlip()
      inner = document.createElement('div')
      bookEl.appendChild(inner)
      pageEls.forEach((p) => inner.appendChild(p))
      buildBook(keep)
    }

    buildBook(0)

    /* ---------- 窗口变了就按新格子重建 ---------- */
    // --cell 是 clamp(19px, 5.6vw, 33px)，绝大多数宽度下它压根不变，所以先比一下尺寸
    let rt = 0
    const onResize = () => {
      window.clearTimeout(rt)
      rt = window.setTimeout(() => {
        if (disposed) return
        const next = bookSize()
        if (next.w === size.w && next.h === size.h) return
        rebuild(cur)
      }, 260)
    }
    window.addEventListener('resize', onResize)

    /* ---------- 落笔 ---------- */
    let fast = false
    let written = 0
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, fast || RM ? 0 : ms))

    const skip = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.edit') || t.closest('.pg')) return
      fast = true
    }
    document.addEventListener('click', skip)

    const bindMeasure = (el: HTMLElement) => {
      el.setAttribute('role', 'button')
      el.setAttribute('tabindex', '0')
      el.setAttribute('aria-pressed', 'false')

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'tick')
      svg.setAttribute('viewBox', '0 0 30 30')
      svg.setAttribute('aria-hidden', 'true')
      svg.style.left = 'calc(var(--cell) * 2 + var(--pad))'
      svg.innerHTML = '<path d="M6 16 L12.5 22.5 L25 6"/>'
      el.appendChild(svg)

      const toggle = () => {
        el.setAttribute('aria-pressed', String(el.classList.toggle('done')))
        if (!disposed) setDoneMeasures(bookEl.querySelectorAll('.measure.done').length)
      }
      el.addEventListener('click', toggle)
      el.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          toggle()
        }
      })
    }

    // 把一行放进它该在的那一页；跨页了就先翻过去
    const placeLine = async (line: Line): Promise<HTMLElement> => {
      const idx = written++
      const pageIdx = Math.floor(idx / ROWS)
      if (pageIdx !== cur && pageIdx < pages) {
        flip?.turnToPage(pageIdx)
        moveCursor(pageIdx)
        if (!fast && !RM) await sleep(FLIP_MS + 60)
      }
      const el = document.createElement('div')
      el.className = 'line' + (line.cls ? ' ' + line.cls : '')
      el.style.textIndent = `calc(var(--cell) * ${line.indent})`
      sheets[Math.min(pageIdx, sheets.length - 1)].appendChild(el)
      return el
    }

    const makeEditable = (id: string) => {
      const span = document.createElement('span')
      span.className = 'edit'
      span.contentEditable = 'true'
      span.spellcheck = false
      span.dataset.role = id
      span.setAttribute('aria-label', id === 'to' ? '称呼，可修改' : '署名，可修改')
      span.addEventListener('input', () => {
        const t = [...span.textContent!]
        if (t.length > 8) span.textContent = t.slice(0, 8).join('')
      })
      return span
    }

    const typeLine = async (line: Line) => {
      const el = await placeLine(line)
      if (disposed) return
      if (!line.atoms.length) {
        await sleep(70)
        return
      }
      if (line.cls === 'measure') bindMeasure(el)

      el.classList.add('caret')
      let span: HTMLSpanElement | null = null
      let spanId: string | null = null

      for (const a of line.atoms) {
        if (a.type === 't') {
          span = null
          spanId = null
          el.appendChild(document.createTextNode(a.ch))
          await sleep(34)
        } else {
          if (spanId !== a.id) {
            span = makeEditable(a.id)
            el.appendChild(span)
            spanId = a.id
          }
          for (const ch of a.v) {
            span!.appendChild(document.createTextNode(ch))
            await sleep(34)
          }
        }
        if (disposed) return
      }
      el.classList.remove('caret')
    }

    const write = async () => {
      for (const line of docLines) {
        if (disposed) return
        await typeLine(line)
      }
      if (disposed) return
      setTyping(false)
      document.removeEventListener('click', skip)
      if (cur !== 0) {
        flip?.turnToPage(0)
        moveCursor(0)
      }
    }

    const text = (a: Atom) => (a.type === 't' ? a.ch : a.v)

    api.current = {
      prev: () => flip?.flipPrev(),
      next: () => flip?.flipNext(),
      turnToPage: (page: number) => {
        flip?.turnToPage(page)
        moveCursor(page)
      },
      appendPs: async (index: number) => {
        const ls = psLines[index]
        if (!ls) return
        for (const l of ls) {
          if (disposed) return
          const el = await placeLine(l)
          el.textContent = l.atoms.map(text).join('')
        }
      },
    }

    void write()

    return () => {
      disposed = true
      window.clearTimeout(rt)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('click', skip)
      teardownFlip()
      bookEl.replaceChildren()
      headEl.style.width = ''
    }
  }, [book, probe, head, now])

  const prev = useCallback(() => api.current.prev(), [])
  const next = useCallback(() => api.current.next(), [])
  const turnToPage = useCallback((page: number) => api.current.turnToPage(page), [])
  const appendPs = useCallback((index: number) => api.current.appendPs(index), [])

  return { pageCount, cursor, typing, doneMeasures, prev, next, turnToPage, appendPs }
}
