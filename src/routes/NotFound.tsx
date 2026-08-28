import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#211c19] text-[#fbf5e4]">
      <p className="text-5xl font-bold tracking-widest">四〇四</p>
      <p className="text-sm text-[#fbf5e4]/50">这一页没有写。</p>
      <Link to="/" className="text-sm text-[#be2e24] underline underline-offset-4">
        回到检讨书
      </Link>
    </main>
  )
}
