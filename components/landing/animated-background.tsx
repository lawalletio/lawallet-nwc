'use client'

export const AnimatedBackground = () => (
  <div className="fixed inset-0 -z-10 h-full w-full overflow-hidden bg-lw-dark">
    <div className="absolute inset-0 grid-pattern" />
    <div className="absolute left-[-15rem] top-[-8rem] h-[35rem] w-[35rem] rounded-full bg-lw-gold/8 blur-[150px] animate-[gradient-move_20s_ease-in-out_infinite]" />
    <div className="absolute right-[-10rem] top-[10rem] h-[30rem] w-[30rem] rounded-full bg-lw-teal/10 blur-[130px] animate-[gradient-move_24s_ease-in-out_infinite_3s]" />
    <div className="absolute bottom-[-8rem] left-[20%] h-[25rem] w-[35rem] rounded-full bg-nwc-purple/6 blur-[120px] animate-[gradient-move_22s_ease-in-out_infinite_6s]" />
    <div className="absolute bottom-[20%] right-[-5rem] h-[20rem] w-[20rem] rounded-full bg-lw-coral/5 blur-[100px] animate-[gradient-move_18s_ease-in-out_infinite_9s]" />
  </div>
)
