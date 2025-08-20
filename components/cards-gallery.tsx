'use client'

import { useState, useRef, useEffect } from 'react'
import { Card } from '@/types'
import { CardPreview } from './card-preview'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './ui/button'

interface CardsGalleryProps {
  cards: Card[]
  className?: string
}

export function CardsGallery({ cards, className = '' }: CardsGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to current card
  useEffect(() => {
    if (scrollContainerRef.current) {
      const cardWidth = scrollContainerRef.current.scrollWidth / cards.length
      scrollContainerRef.current.scrollTo({
        left: currentIndex * cardWidth,
        behavior: 'smooth'
      })
    }
  }, [currentIndex, cards.length])

  // Update currentIndex based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current && cards.length > 0) {
        const scrollLeft = scrollContainerRef.current.scrollLeft
        const cardWidth = scrollContainerRef.current.scrollWidth / cards.length
        const newIndex = Math.round(scrollLeft / cardWidth)

        if (
          newIndex !== currentIndex &&
          newIndex >= 0 &&
          newIndex < cards.length
        ) {
          setCurrentIndex(newIndex)
        }
      }
    }

    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      return () => scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [currentIndex, cards.length])

  if (cards.length === 1) {
    return <CardPreview card={cards[0]} />
  }

  const goToCard = (index: number) => {
    setCurrentIndex(index)
  }

  // Touch and mouse handlers for smooth scrolling
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setStartX(e.pageX - (scrollContainerRef.current?.offsetLeft || 0))
    setScrollLeft(scrollContainerRef.current?.scrollLeft || 0)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    const x = e.pageX - (scrollContainerRef.current?.offsetLeft || 0)
    const walk = (x - startX) * 2
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollLeft - walk
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true)
    setStartX(
      e.touches[0].pageX - (scrollContainerRef.current?.offsetLeft || 0)
    )
    setScrollLeft(scrollContainerRef.current?.scrollLeft || 0)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const x = e.touches[0].pageX - (scrollContainerRef.current?.offsetLeft || 0)
    const walk = (x - startX) * 2
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollLeft - walk
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  // Debug logging
  console.log('CardsGallery render:', {
    cardsLength: cards.length,
    currentIndex,
    cards
  })

  if (cards.length === 0) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <p className="text-muted-foreground">No cards available</p>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {/* Cards Container */}
      <div
        ref={scrollContainerRef}
        className="flex gap-6 overflow-x-auto scrollbar-hide snap-x snap-mandatory py-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {cards.map((card, index) => (
          <div
            key={card.id}
            className={`flex-shrink-0 snap-center transition-all duration-300 ease-out min-w-[300px] ${
              index === currentIndex
                ? 'scale-100 opacity-100'
                : 'scale-95 opacity-70'
            }`}
          >
            <div className="relative group border border-white/20 rounded-2xl overflow-hidden">
              <CardPreview card={card} />
              {/* Card Info Overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-2xl min-h-[60px] flex flex-col justify-end">
                <h3 className="text-white font-semibold text-sm">
                  {card.title || `Card ${index + 1}`}
                </h3>
                {card.username && (
                  <p className="text-white/80 text-xs">@{card.username}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Dots Indicator */}
      {cards.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {cards.map((_, index) => (
            <button
              key={index}
              onClick={() => goToCard(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'bg-primary scale-125'
                  : 'bg-muted hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>
      )}

      {/* Card Counter */}
      {cards.length > 1 && (
        <div className="text-center mt-2 text-sm text-muted-foreground">
          {currentIndex + 1} of {cards.length}
        </div>
      )}

      <style jsx>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  )
}
