'use client'

import React from 'react'

export const AnimatedBackground = () => {
  const [scrollY, setScrollY] = React.useState(0)

  React.useEffect(() => {
    const handler = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <div className="fixed inset-0 -z-10 h-full w-full overflow-hidden bg-lw-dark">
      <div className="absolute inset-0 grid-pattern" />
      <div className="absolute left-[-15rem] top-[-8rem] h-[35rem] w-[35rem] rounded-full bg-lw-gold/8 blur-[150px] animate-[gradient-move_20s_ease-in-out_infinite]" />
      <div className="absolute right-[-10rem] top-[10rem] h-[30rem] w-[30rem] rounded-full bg-lw-teal/10 blur-[130px] animate-[gradient-move_24s_ease-in-out_infinite_3s]" />
      <div className="absolute bottom-[-8rem] left-[20%] h-[25rem] w-[35rem] rounded-full bg-nwc-purple/6 blur-[120px] animate-[gradient-move_22s_ease-in-out_infinite_6s]" />
      <div className="absolute bottom-[20%] right-[-5rem] h-[20rem] w-[20rem] rounded-full bg-lw-coral/5 blur-[100px] animate-[gradient-move_18s_ease-in-out_infinite_9s]" />

      {/* Giant @ symbol with parallax */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        aria-hidden="true"
      >
        <span
          className="text-[40rem] sm:text-[55rem] md:text-[70rem] font-black leading-none"
          style={{
            background: 'linear-gradient(180deg, rgba(245, 166, 35, 0.03) 0%, rgba(38, 166, 154, 0.02) 50%, rgba(139, 92, 246, 0.015) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            WebkitTextStroke: '1.5px rgba(245, 166, 35, 0.03)',
            transform: `translateY(${scrollY * -0.08}px) rotate(${-8 + scrollY * 0.003}deg) scale(${1 + scrollY * 0.00005})`,
            transition: 'transform 0.1s linear',
            filter: 'blur(1px)',
          }}
        >
          @
        </span>
      </div>
    </div>
  )
}
