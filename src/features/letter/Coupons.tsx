import { useState, type Ref } from 'react'
import { COUPONS } from './content'

interface Props {
  visible: boolean
  ref?: Ref<HTMLDivElement>
}

/** 盖完章才发下来的三张券，点一下就算兑现。 */
export default function Coupons({ visible, ref }: Props) {
  const [used, setUsed] = useState<boolean[]>(() => COUPONS.map(() => false))

  const use = (i: number) => setUsed((prev) => prev.map((v, j) => (j === i ? true : v)))

  return (
    <div className={'coupons' + (visible ? ' on' : '')} ref={ref} aria-hidden={!visible}>
      {COUPONS.map((c, i) => (
        <div
          key={c.title}
          className={'coupon' + (used[i] ? ' used' : '')}
          role="button"
          tabIndex={visible ? 0 : -1}
          aria-disabled={used[i]}
          onClick={() => use(i)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              use(i)
            }
          }}
        >
          <span className="used">已兑换</span>
          <h3>{c.title}</h3>
          <span className="qty">{c.qty}</span>
          <p>{c.desc}</p>
        </div>
      ))}
    </div>
  )
}
