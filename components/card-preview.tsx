import { Card } from '@/types'

export function CardPreview({ card }: { card: Card }) {
  return (
    <>
      {/* Card Preview */}
      <div
        className="relative w-full max-w-96 mx-auto aspect-[1.5/1] rounded-2xl overflow-hidden group"
        style={{
          backgroundImage: `url(${card.design.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {/* Card Overlay */}
        {/* Animated Lightning Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-80 w-[200%] transform -skew-x-12 animate-shine" />

        {/* Card Content */}
        {/* <div className="absolute inset-0 p-6 flex flex-col justify-between text-white">
              <div className="flex justify-end items-start">
                <div className="text-right">
                  <img
                    src="/nwc-logo.png"
                    alt="NWC"
                    className="w-16 h-16 object-contain"
                  />
                </div>
              </div>
            </div> */}
      </div>
      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
        @keyframes shine {
          0% {
            transform: skewX(-12deg) translateX(-100%);
          }
          80% {
            transform: skewX(-12deg) translateX(100%);
          }
          100% {
            transform: skewX(-12deg) translateX(100%);
          }
        }
        .animate-shine {
          animation: shine 2.5s linear infinite;
        }
      `}</style>
    </>
  )
}
