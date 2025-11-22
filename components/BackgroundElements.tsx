'use client'

export function BackgroundElements() {
  return (
    <>
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
    </>
  )
}

