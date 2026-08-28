/** 「予以原谅」朱印。feTurbulence + feDisplacementMap 做出印泥压出来的毛边。 */
export default function Seal() {
  return (
    <svg className="seal" viewBox="0 0 120 120">
      <defs>
        <filter id="seal-rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.7"
            numOctaves="4"
            seed="9"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="3.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter="url(#seal-rough)">
        <rect x="5" y="5" width="110" height="110" rx="4" fill="#be2e24" />
        <g
          fill="#fff5ec"
          fontFamily="Songti SC, SimSun, serif"
          fontWeight="700"
          fontSize="44"
          textAnchor="middle"
        >
          <text x="35" y="52">
            予
          </text>
          <text x="85" y="52">
            以
          </text>
          <text x="35" y="102">
            原
          </text>
          <text x="85" y="102">
            谅
          </text>
        </g>
      </g>
    </svg>
  )
}
