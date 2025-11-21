'use client'

import { useState, useEffect } from 'react'

interface Star {
  left: number
  top: number
  width: number
  height: number
  opacity: number
  animation: string
}

export function BackgroundElements() {
  const [stars, setStars] = useState<Star[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Generate stars only on client side to avoid hydration mismatch
    setMounted(true)
    const generatedStars: Star[] = Array.from({ length: 100 }).map(() => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      width: Math.random() * 2 + 1,
      height: Math.random() * 2 + 1,
      opacity: Math.random() * 0.8 + 0.2,
      animation: `${Math.random() * 3 + 2}s infinite`,
    }))
    setStars(generatedStars)
  }, [])

  return (
    <>
      {/* Starry sky */}
      {mounted && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          {stars.map((star, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${star.left}%`,
                top: `${star.top}%`,
                width: `${star.width}px`,
                height: `${star.height}px`,
                opacity: star.opacity,
                animation: `twinkle ${star.animation}`,
              }}
            />
          ))}
        </div>
      )}

      {/* Mountains in the background */}
      <div className="fixed bottom-0 left-0 right-0 h-1/3 pointer-events-none opacity-20">
        <svg
          viewBox="0 0 1200 400"
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          <path
            d="M0,400 L200,300 L400,350 L600,250 L800,300 L1000,200 L1200,250 L1200,400 Z"
            fill="url(#mountainGradient)"
            opacity="0.6"
          />
          <path
            d="M0,400 L150,320 L350,370 L550,270 L750,320 L950,220 L1200,270 L1200,400 Z"
            fill="url(#mountainGradient)"
            opacity="0.4"
          />
          <defs>
            <linearGradient id="mountainGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2d3748" />
              <stop offset="100%" stopColor="#1a202c" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Gradient effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sf-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-sf-secondary/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-sf-warm/5 rounded-full blur-3xl transform -translate-x-1/2 -translate-y-1/2" />
      </div>

      <style jsx>{`
        @keyframes twinkle {
          0%, 100% {
            opacity: 0.2;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
    </>
  )
}

