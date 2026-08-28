import { useRef, useState, type CSSProperties } from 'react'

const NO_TEXT = ['再想想', '让我想想', '要不算了', '嗯……', '再看看', '按不动了']
const MAX_DODGES = 5

interface Props {
  hint: string
  /** 正文写完之前不出现 */
  visible: boolean
  /** 已经盖过章了 */
  settled: boolean
  onYes: () => void
  /** 每躲一次，往稿纸上补一条附言 */
  onDodge: (index: number) => void
}

/**
 * 「予以原谅」和会躲的「再想想」。
 * 躲满五次以后按钮认输：文案变成「按不动了」，回到原位并禁用。
 */
export default function Verdict({ hint, visible, settled, onYes, onDodge }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const noRef = useRef<HTMLButtonElement>(null)
  const [dodges, setDodges] = useState(0)
  const [transform, setTransform] = useState('')

  const dead = dodges >= MAX_DODGES

  const dodge = () => {
    if (dead || settled) return
    const stage = stageRef.current
    const no = noRef.current
    if (!stage || !no) return

    const box = stage.getBoundingClientRect()
    const b = no.getBoundingClientRect()
    const x = -(Math.random() * (box.width - b.width) * 0.78) - 4
    const y = Math.random() * 46 - 16
    const deg = Math.random() * 10 - 5
    setTransform(`translate(${x.toFixed(0)}px,${y.toFixed(0)}px) rotate(${deg.toFixed(1)}deg)`)

    setDodges(dodges + 1)
    onDodge(dodges)
  }

  // --grow 让「予以原谅」每被躲一次就长大一点，.yes 从这里继承
  const stageStyle = { '--grow': (1 + dodges * 0.055).toFixed(3) } as CSSProperties

  return (
    <div
      className={'verdict' + (visible ? ' on' : '')}
      id="verdict"
      ref={stageRef}
      style={stageStyle}
    >
      <div className="hint">{hint}</div>
      <button className="btn yes" onClick={onYes} disabled={settled}>
        予以原谅
      </button>
      <button
        className={'btn no' + (dead ? ' dead' : '')}
        ref={noRef}
        disabled={dead || settled}
        style={{ transform: dead ? 'translate(0,0)' : transform }}
        onPointerEnter={dodge}
        onPointerDown={(e) => {
          e.preventDefault()
          dodge()
        }}
        onFocus={dodge}
      >
        {NO_TEXT[dodges]}
      </button>
    </div>
  )
}
