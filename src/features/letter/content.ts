import { E, ROWS, T, cnDate, layout, type Line, type Par } from './typeset'

/** 检讨书正文 */
export function buildDoc(now: Date): Par[] {
  return [
    { segs: [T('尊敬的'), E('to', '秋宝宝'), T('台鉴：')] },
    { blank: true },
    { indent: 2, segs: [T('今天的事，我想认真地跟你说几句话。')] },
    { blank: true },
    { cls: 'head', segs: [T('一、事实经过')] },
    {
      indent: 2,
      segs: [
        T(
          '你大姨妈本来明天才来，被我一气，硬是提前了一整天。你捂着肚子的时候，我还在跟你争谁有理。'
        ),
      ],
    },
    { blank: true },
    { cls: 'head', segs: [T('二、思想根源')] },
    {
      indent: 2,
      segs: [T('我总当吵赢了就算翻篇，忘了那口气是不会自己散的，它会落到你身上，落成实打实的疼。')],
    },
    { blank: true },
    { cls: 'head', segs: [T('三、整改措施')] },
    // 每条正文限 11 字以内：首行缩进 2 格 + 方框与全角空格 2 格，一共 15 格
    { measure: '你说疼，立刻闭嘴烧水' },
    { measure: '那几天的理，一律归你' },
    { measure: '想争对错，先想你肚子' },
    { blank: true },
    { indent: 2, segs: [T('以上句句属实，请你过目，也请你原谅。')] },
    { blank: true },
    { indent: 5, hang: 5, segs: [T('检讨人：'), E('from', '鱼宝宝')] },
    { indent: 4, hang: 4, segs: [T(cnDate(now))] },
  ]
}

/** 每躲一次「再想想」，就往稿纸上补一条附言 */
export const PS = [
  '附一：我错了，是害你疼的那种错。',
  '附二：红糖水已经烧上了，不烫。',
  '附三：暖宝宝买了一整盒，放床头了。',
  '附四：这几天你说什么都对。',
  '附五：真的，按左边那个吧。',
]

export const COUPONS = [
  {
    title: '免吵架券',
    qty: '× 1 张 · 那几天专用',
    desc: '你说停就停，一个字都不多说，喊停方直接判赢，不许翻旧账。',
  },
  {
    title: '红糖水券',
    qty: '× 无限张 · 随叫随到',
    desc: '温度刚好，不烫嘴。半夜也烧，不许说不用了。',
  },
  {
    title: '家务券',
    qty: '× 7 张 · 本周内',
    desc: '拖地、洗碗、倒垃圾任选，用券当天不许发出叹气声。',
  },
]

export const HINTS = [
  '请批阅。勾选整改措施后再作决定。',
  '已核准 1 条。还有两条没看。',
  '已核准 2 条。就差一条了。',
  '三条全部核准。他在等你按左边那个。',
]

export interface Document {
  docLines: Line[]
  /** 每条附言各自的行，按需一条条追加 */
  psLines: Line[][]
  pageCount: number
}

/**
 * 先把全文排好版，再据此决定要几页。
 * 附言虽然要等用户去躲按钮才出现，但页数必须一开始就定死 —— 翻页库不支持中途加页。
 */
export function buildDocument(now: Date): Document {
  const docLines: Line[] = []
  for (const par of buildDoc(now)) for (const l of layout(par)) docLines.push(l)

  const psLines = PS.map((t) => layout({ cls: 'ps', indent: 0, hang: 1, segs: [T(t)] }))
  const reserved = psLines.reduce((s, ls) => s + ls.length, 0)
  const pageCount = Math.max(2, Math.ceil((docLines.length + reserved) / ROWS))

  return { docLines, psLines, pageCount }
}
