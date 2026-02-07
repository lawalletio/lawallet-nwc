'use client'

import { useScrollAnimation, useScrollProgress } from './hooks'

const cardRows = [
  {
    cards: [
      '/cards/card1.png', '/cards/card2.png', '/cards/card3.png', '/cards/card4.png',
      '/cards/card5.png', '/cards/card6.png', '/cards/card7.png', '/cards/card8.png',
      '/cards/card9.png', '/cards/card10.png', '/cards/card11.png', '/cards/card12.png',
      '/cards/card13.png', '/cards/card14.png',
    ],
    direction: 'left' as const,
    duration: '60s',
  },
  {
    cards: [
      '/cards/card15.png', '/cards/card16.png', '/cards/card17.png', '/cards/card18.png',
      '/cards/card19.png', '/cards/card20.png', '/cards/card21.png', '/cards/card22.png',
      '/cards/card23.png', '/cards/card24.png', '/cards/card25.png', '/cards/card26.png',
      '/cards/card27.png',
    ],
    direction: 'right' as const,
    duration: '55s',
  },
  {
    cards: [
      '/cards/card28.png', '/cards/card29.png', '/cards/card30.png', '/cards/card31.png',
      '/cards/card32.png', '/cards/card33.png', '/cards/card34.png', '/cards/card35.png',
      '/cards/card36.png', '/cards/card37.png', '/cards/card38.png', '/cards/card39.png',
      '/cards/card40.png',
    ],
    direction: 'left' as const,
    duration: '65s',
  }
]

export const FlowSection = () => {
  const { ref, isVisible } = useScrollAnimation()
  const { ref: parallaxRef, scrollProgress } = useScrollProgress()

  const rotateX = 14 - scrollProgress * 10
  const translateY = (0.5 - scrollProgress) * 40
  const scale = 0.92 + scrollProgress * 0.08

  return (
    <section id="nfc-cards" className="py-20 sm:py-28 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4">
        <div ref={ref} className="text-center mb-12 sm:mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-teal mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// NFC Cards'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Create custom <span className="text-gradient-gold">NFC cards!</span>
          </h2>
          <p
            className={`mt-4 text-white/30 max-w-xl mx-auto transition-all duration-1000 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Design branded payment cards for your community. Users tap to pay with Lightning — no app needed.
          </p>
        </div>

        {/* 3D Carousel with Parallax */}
        <div
          ref={parallaxRef}
          className={`relative transition-all duration-1000 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
          style={{ perspective: '1200px' }}
        >
          <div
            className="will-change-transform"
            style={{
              transform: `rotateX(${rotateX}deg) translateY(${translateY}px) scale(${scale})`,
              transformStyle: 'preserve-3d',
              transition: 'transform 0.1s linear',
            }}
          >
            {/* Gradient fade masks */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24 sm:w-40 z-10 bg-gradient-to-r from-lw-dark to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24 sm:w-40 z-10 bg-gradient-to-l from-lw-dark to-transparent" />

            {/* Ambient glows behind cards */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none -z-10">
              <div className="w-[30rem] h-40 bg-lw-gold/8 blur-[120px] rounded-full" />
            </div>
            <div className="absolute top-0 left-1/4 pointer-events-none -z-10">
              <div className="w-48 h-48 bg-nwc-purple/5 blur-[80px] rounded-full" />
            </div>
            <div className="absolute bottom-0 right-1/4 pointer-events-none -z-10">
              <div className="w-40 h-40 bg-lw-teal/5 blur-[80px] rounded-full" />
            </div>

            {/* Card rows */}
            <div className="space-y-4 sm:space-y-5 overflow-hidden py-4">
              {cardRows.map((row, rowIndex) => (
                <div key={rowIndex} className="overflow-hidden">
                  <div
                    className="card-track flex gap-4 sm:gap-5 will-change-transform"
                    style={{
                      animation: `card-scroll-${row.direction} ${row.duration} linear infinite`,
                      width: 'max-content',
                    }}
                  >
                    {/* Duplicate cards for seamless loop */}
                    {[...row.cards, ...row.cards].map((src, cardIndex) => (
                      <div
                        key={`${rowIndex}-${cardIndex}`}
                        className="shrink-0 group/card"
                        style={{
                          transform: `rotateY(${rowIndex === 1 ? 2 : -2}deg)`,
                          transformStyle: 'preserve-3d',
                        }}
                      >
                        <img
                          src={src}
                          alt="NFC Card Design"
                          className="w-40 sm:w-52 md:w-60 h-auto rounded-xl shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)] border border-white/[0.08] pointer-events-none select-none transition-all duration-500 group-hover/card:shadow-[0_12px_40px_-8px_rgba(245,166,35,0.2)] group-hover/card:border-white/20 group-hover/card:scale-105"
                          draggable={false}
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
