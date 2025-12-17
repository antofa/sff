import { Suspense } from 'react'
import HomePage from '@/components/HomePage'

export default function DecksPage() {
  return (
    <Suspense fallback={<div />}>
      <HomePage />
    </Suspense>
  )
}
