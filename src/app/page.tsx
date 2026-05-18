import { Suspense } from 'react'
import EnricherPage from '@/components/EnricherPage'

export default function Home() {
  return (
    <Suspense fallback={null}>
      <EnricherPage />
    </Suspense>
  )
}
