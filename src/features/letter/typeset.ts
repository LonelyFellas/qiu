/**
 * 稿纸排版引擎。
 *
 * 稿纸是 COLS × ROWS 的方格，一个汉字占一格，所以断行是纯粹按格子数算的，
 * 不能交给浏览器。这里额外处理两条中文排版规矩：
 *   - 避头尾：行首不能是收尾标点（。，、）；行尾不能是开启标点（「（）。
 *   - 悬挂标点：单个收尾标点允许挤在行尾第 16 格，不占正式格位。
 */

export const COLS = 15
export const ROWS = 18

/** 可就地编辑的字段（称呼、署名） */
export type EditId = 'to' | 'from'

export type Seg = { type: 't'; v: string } | { type: 'e'; id: EditId; v: string }

/** 排版的最小单位：一个汉字，或一整块可编辑字段 */
export type Atom = { type: 't'; ch: string } | { type: 'e'; id: EditId; v: string; w: number }

export interface Line {
  cls: string
  indent: number
  atoms: Atom[]
}

export interface Par {
  segs?: Seg[]
  cls?: string
  /** 首行缩进，单位是格 */
  indent?: number
  /** 转行后的悬挂缩进，单位是格 */
  hang?: number
  /** 空行 */
  blank?: boolean
  /** 整改措施，会自动加上 □ 和缩进，并变成可勾选的行 */
  measure?: string
}

export const T = (v: string): Seg => ({ type: 't', v })
export const E = (id: EditId, v: string): Seg => ({ type: 'e', id, v })

const CLOSE = '。，、；：！？」』）】》〉…·”’'
const OPEN = '「『（【《〈“‘'

export function layout(par: Par): Line[] {
  if (par.blank) return [{ cls: '', indent: 0, atoms: [] }]

  let segs = par.segs ?? []
  let cls = par.cls ?? ''
  let first = par.indent ?? 0
  let hang = par.hang ?? 0
  if (par.measure) {
    segs = [T('□　' + par.measure)]
    cls = 'measure'
    first = 2
    hang = 4
  }

  const atoms: Atom[] = []
  for (const s of segs) {
    if (s.type === 't') for (const ch of s.v) atoms.push({ type: 't', ch })
    else atoms.push({ type: 'e', id: s.id, v: s.v, w: [...s.v].length })
  }

  const isClose = (a: Atom) => a.type === 't' && CLOSE.includes(a.ch)
  const width = (arr: Atom[]) => arr.reduce((s, x) => s + (x.type === 'e' ? x.w : 1), 0)

  const lines: Line[] = []
  let cur: Atom[] = []
  let w = first
  let ind = first
  let hung = false

  const flush = () => {
    lines.push({ cls, indent: ind, atoms: cur })
    cur = []
    w = hang
    ind = hang
    hung = false
  }

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    const aw = a.type === 'e' ? a.w : 1

    // 开启标点落在最后一格 —— 提前换行，别让它孤零零挂在行尾
    if (a.type === 't' && OPEN.includes(a.ch) && w + 1 >= COLS && cur.length) flush()

    if (w + aw > COLS && cur.length) {
      if (isClose(a)) {
        let k = 0
        while (atoms[i + k] && isClose(atoms[i + k])) k++
        // 只有一个收尾标点：悬挂在行尾，不换行
        if (k === 1 && !hung) {
          cur.push(a)
          hung = true
          continue
        }
        // 连着好几个：把上一个字一起拽到下一行，免得标点顶在行首
        const moved = cur.length > 1 ? [cur.pop()!] : []
        flush()
        cur = moved
        w = hang + width(moved)
        cur.push(a)
        w += aw
        continue
      }
      flush()
    }

    cur.push(a)
    w += aw
  }

  if (cur.length) lines.push({ cls, indent: ind, atoms: cur })
  return lines
}

/* ================= 中文数字与日期 ================= */

const D = '〇一二三四五六七八九'

export const cnNum = (n: number): string =>
  n <= 10
    ? n === 10
      ? '十'
      : D[n]
    : n < 20
      ? '十' + D[n - 10]
      : D[Math.floor(n / 10)] + '十' + (n % 10 ? D[n % 10] : '')

export const cnDate = (now: Date): string =>
  String(now.getFullYear())
    .split('')
    .map((c) => D[+c])
    .join('') +
  '年' +
  cnNum(now.getMonth() + 1) +
  '月' +
  cnNum(now.getDate()) +
  '日'

export const docNo = (now: Date): string => {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `编号 LOVE-${now.getFullYear()}-${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
}
