import { BrowserRouter, Route, Routes } from 'react-router-dom'
import LetterPage from '@/routes/LetterPage'
import NotFound from '@/routes/NotFound'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<LetterPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
