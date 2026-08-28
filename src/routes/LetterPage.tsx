import { useCallback, useEffect, useRef, useState } from 'react'
import Confetti from '@/features/letter/Confetti'
import Coupons from '@/features/letter/Coupons'
import Seal from '@/features/letter/Seal'
import Verdict from '@/features/letter/Verdict'
import { HINTS } from '@/features/letter/content'
import { cnNum, docNo } from '@/features/letter/typeset'
import { FLIP_MS, useLetterBook } from '@/features/letter/useLetterBook'
import '@/features/letter/letter.css'

export default function LetterPage() {
  const [now] = useState(() => new Date())
  const [reducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

  const bookRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const couponsRef = useRef<HTMLDivElement>(null)

  const { pageCount, cursor, typing, doneMeasures, prev, next, turnToPage, appendPs } =
    useLetterBook({ book: bookRef, probe: probeRef, head: headRef, now })

  const [stamped, setStamped] = useState(false)
  const [markOn, setMarkOn] = useState(false)
  const [couponsOn, setCouponsOn] = useState(false)
  const [verdictGone, setVerdictGone] = useState(false)
  const [shake, setShake] = useState(false)
  const [burst, setBurst] = useState(0)
  const [live, setLive] = useState('')

  const timers = useRef<number[]>([])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])
  useEffect(() => {
    const ids = timers.current
    return () => ids.forEach(clearTimeout)
  }, [])

  const stamp = () => {
    if (stamped) return
    setStamped(true)
    setLive('已盖章：予以原谅。')

    // 印章盖在最后一页上，不在那页就先翻过去
    const last = pageCount - 1
    const wait = cursor === last ? 0 : FLIP_MS + 80
    if (cursor !== last) turnToPage(last)

    later(() => {
      setMarkOn(true)
      if (!reducedMotion) {
        setShake(true)
        later(() => setShake(false), 520)
        setBurst((n) => n + 1)
      }
    }, wait + 160)

    later(() => setVerdictGone(true), 500)

    later(() => {
      setCouponsOn(true)
      couponsRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
      })
    }, wait + 620)
  }

  // 写完到盖章之间不再提示，页脚留空
  const foot = couponsOn ? '附页三张，点一下就算兑现' : typing ? '正在书写⋯⋯点一下可跳过' : ''

  return (
    <div className="desk">
      {/* 量当前一格多少像素用的探针 */}
      <div id="probe" ref={probeRef} />

      <div className={'desk-card' + (shake ? ' shake' : '')}>
        <div className="head" ref={headRef}>
          <div className="doc-no">{docNo(now)}</div>
          <div className="title">检讨书</div>
          <div className="rule" />
        </div>

        {/* 稿纸与翻页由 useLetterBook 全权命令式接管，这里只提供容器 */}
        <div className="book" ref={bookRef} />

        <div className="pager" hidden={pageCount < 2}>
          <button className="pg" onClick={prev} disabled={cursor === 0}>
            ◀ 上一页
          </button>
          <span className="pgno">第 {cnNum(cursor + 1)} 页</span>
          <button className="pg" onClick={next} disabled={cursor >= pageCount - 1}>
            下一页 ▶
          </button>
        </div>

        <div
          className={
            'verdict-mark' + (markOn ? ' on' : '') + (cursor !== pageCount - 1 ? ' hide' : '')
          }
          aria-hidden="true"
        >
          <div className="pi">
            阅。
            <br />
            下不为例。
          </div>
          <Seal />
        </div>
      </div>

      {!verdictGone && (
        <Verdict
          hint={HINTS[doneMeasures]}
          visible={!typing}
          settled={stamped}
          onYes={stamp}
          onDodge={appendPs}
        />
      )}

      <Coupons visible={couponsOn} ref={couponsRef} />

      <div className="footer">
        {foot && <span>{foot}</span>}
        {couponsOn && (
          <button className="link" onClick={() => location.reload()}>
            重写一份
          </button>
        )}
      </div>

      <Confetti trigger={burst} />
      <div className="sr" aria-live="polite">
        {live}
      </div>
    </div>
  )
}
