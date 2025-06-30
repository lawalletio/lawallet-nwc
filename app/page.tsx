'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Github,
  Check,
  Nfc,
  Wallet,
  Cpu,
  LinkIcon,
  ArrowRight,
  ArrowLeft,
  SmartphoneNfc
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import Link from 'next/link'

// Custom hook for scroll-triggered animations
const useScrollAnimation = (threshold = 0.1, rootMargin = '50px') => {
  const [isVisible, setIsVisible] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
        }
      },
      { threshold, rootMargin }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return { ref, isVisible }
}

// Custom hook for scroll progress
const useScrollProgress = () => {
  const [scrollProgress, setScrollProgress] = React.useState(0)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleScroll = () => {
      if (!ref.current) return

      const rect = ref.current.getBoundingClientRect()
      const windowHeight = window.innerHeight
      const elementHeight = rect.height

      const progress = Math.max(
        0,
        Math.min(1, (windowHeight - rect.top) / (windowHeight + elementHeight))
      )
      setScrollProgress(progress)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return { ref, scrollProgress }
}

const AnimatedBackground = () => (
  <div className="fixed inset-0 -z-10 h-full w-full overflow-hidden bg-gray-950">
    <div className="absolute left-[-20rem] top-[-10rem] h-[30rem] w-[50rem] rounded-full bg-[#001c80]/30 blur-[150px] animate-[gradient-move_18s_ease-in-out_infinite]" />
    <div className="absolute right-[-15rem] top-[5rem] h-[30rem] w-[40rem] rounded-full bg-[#1ac7ff]/20 blur-[120px] animate-[gradient-move_20s_ease-in-out_infinite_2s]" />
    <div className="absolute bottom-[-10rem] left-[10rem] h-[25rem] w-[40rem] rounded-full bg-[#04ffb1]/20 blur-[100px] animate-[gradient-move_22s_ease-in-out_infinite_4s]" />
    <div className="absolute bottom-[5rem] right-[-5rem] h-[30rem] w-[30rem] rounded-full bg-[#ff1ff1]/20 blur-[130px] animate-[gradient-move_24s_ease-in-out_infinite_6s]" />
  </div>
)

const Header = () => (
  <header className="sticky top-0 z-50 py-4 px-4 sm:px-6 lg:px-8 bg-black/50 backdrop-blur-lg border-b border-white/10 animate-fade-in-down">
    <div className="container mx-auto flex items-center justify-between">
      <div className="flex items-center gap-3">
        <img src="/nwc-logo.png" alt="NWC Logo" className="h-8 w-auto" />
      </div>
      <Button
        variant="ghost"
        className="text-white hover:bg-gray-800 hover:text-white transition-all duration-300 hover:scale-105"
        asChild
      >
        <a
          href="https://github.com/agustinkassis/boltcard-nwc"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub Repository"
        >
          <Github className="h-5 w-5 mr-2" />
          Fork me
        </a>
      </Button>
    </div>
  </header>
)

const HeroSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="py-20 sm:py-32">
      <div
        ref={ref}
        className={`container mx-auto px-4 text-center transition-all duration-1000 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <h1
          className={`text-4xl md:text-6xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 transition-all duration-1200 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          BoltCard meets NWC
        </h1>
        <p
          className={`mt-8 max-w-3xl mx-auto text-xl md:text-2xl text-gray-300 leading-relaxed font-light transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <span className="bg-gradient-to-r from-gray-200 to-gray-400 bg-clip-text text-transparent">
            Build your own NFC cards and connect them with your own NWC.
          </span>
          <br />
          <span className="text-gray-400">
            Just top it up via <b>Lightning Address</b> and start tapping.
          </span>
        </p>
        <div
          className={`mt-12 flex flex-col sm:flex-row gap-4 justify-center items-center transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <Button
            size="lg"
            className="px-8 py-4 rounded-full bg-nwc-purple hover:bg-nwc-purple/90 text-white transition-all duration-300 ease-in-out shadow-lg hover:shadow-nwc-purple/20 hover:scale-105 hover:-translate-y-1"
            onClick={() => {
              const waitlistSection =
                document.getElementById('waitlist-section')
              waitlistSection?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            Join Waitlist <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-4 rounded-full border-white/20 text-black hover:bg-white/10 transition-all duration-300 ease-in-out bg-white hover:scale-105 hover:text-white hover:-translate-y-1"
              asChild
            >
              <Link href="/admin">Admin Demo</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-4 rounded-full border-white/20 text-black hover:bg-white/10 transition-all duration-300 ease-in-out bg-white hover:scale-105 hover:text-white hover:-translate-y-1"
              asChild
            >
              <Link href="/wallet">
                <Wallet className="mr-2 h-5 w-5" />
                Wallet Demo
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

const flowSteps = [
  {
    title: '1. Create a new card',
    description:
      'In your dashboard, enter a Lightning Address or NWC string to provision a new card.',
    content: (
      <div className="w-full p-6 bg-gray-800/50 rounded-lg border border-white/10 flex flex-col gap-4">
        <Input
          placeholder="Lightning Address or NWC string"
          className="bg-gray-900/80 border-white/10"
        />
        <Input
          placeholder="Card Name (e.g., 'My Spending Card')"
          className="bg-gray-900/80 border-white/10"
        />
        <Button className="w-full bg-nwc-purple hover:bg-nwc-purple/90 text-white">
          Create Card
        </Button>
      </div>
    )
  },
  {
    title: '2. Write to NFC Chip',
    description:
      'Use a simple USB NFC writer to program the secure NTAG424 chip.',
    content: (
      <div className="flex items-center justify-center w-full h-full">
        <div className="relative">
          <div className="w-32 h-20 bg-gradient-to-br from-gray-700 to-gray-900 rounded-lg border border-white/20 flex items-center justify-center">
            <Nfc className="h-8 w-8 text-nwc-orange" />
          </div>
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
            <Check className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    )
  },
  {
    title: '3. Print Setup QR',
    description:
      'An NWC setup link is auto-generated. Print it for the user to scan.',
    content: (
      <div className="flex items-center justify-center w-full h-full">
        <div className="w-32 h-32 bg-white rounded-lg p-4 shadow-lg">
          <div className="w-full h-full bg-black rounded grid grid-cols-8 gap-px">
            {Array.from({ length: 64 }).map((_, i) => (
              <div
                key={i}
                className={`${Math.random() > 0.5 ? 'bg-black' : 'bg-white'} rounded-sm`}
              />
            ))}
          </div>
        </div>
      </div>
    )
  },
  {
    title: '4. User Links Wallet',
    description:
      'The user scans the QR, opens their wallet, and authorizes the connection.',
    content: (
      <div className="flex items-center justify-center w-full h-full">
        <div className="w-24 h-40 bg-gray-800 rounded-2xl border-2 border-gray-600 flex flex-col items-center justify-center gap-2 p-4">
          <Wallet className="h-8 w-8 text-nwc-purple" />
          <div className="text-xs text-gray-300 text-center">
            Authorize Connection
          </div>
          <div className="w-full h-6 bg-nwc-purple/20 rounded flex items-center justify-center">
            <Check className="h-4 w-4 text-nwc-purple" />
          </div>
        </div>
      </div>
    )
  },
  {
    title: '5. Tap to Pay',
    description:
      'The card is ready! Tap on any compatible POS to make a Lightning payment via NWC.',
    content: (
      <div className="flex items-center justify-center w-full h-full gap-4">
        <div className="w-20 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
          <span className="text-white text-xs font-bold">CARD</span>
        </div>
        <div className="text-2xl text-gray-400">→</div>
        <div className="w-16 h-16 bg-gray-800 rounded-lg border border-white/20 flex items-center justify-center">
          <span className="text-green-400 text-xs">POS</span>
        </div>
      </div>
    )
  },
  {
    title: '6. Supported Wallets',
    description:
      'Start with Alby or Flash, and upgrade to full sovereignty anytime.',
    content: (
      <div className="flex items-center justify-center gap-6 h-full w-full">
        <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-black">
          A
        </div>
        <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center font-bold text-white">
          F
        </div>
        <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center font-bold text-white">
          P
        </div>
      </div>
    )
  }
]

const FlowSection = () => {
  const [currentStep, setCurrentStep] = React.useState(0)
  const [isHovered, setIsHovered] = React.useState(false)
  const { ref, isVisible } = useScrollAnimation()
  const { ref: progressRef, scrollProgress } = useScrollProgress()

  const nextStep = () => {
    setCurrentStep(prev => (prev + 1) % flowSteps.length)
  }

  const prevStep = () => {
    setCurrentStep(prev => (prev - 1 + flowSteps.length) % flowSteps.length)
  }

  const currentStepData = flowSteps[currentStep]

  return (
    <section ref={progressRef} className="py-20 sm:py-24">
      <div className="container mx-auto px-4">
        <h2
          className={`text-center text-3xl md:text-4xl font-bold tracking-tight text-white mb-16 transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          How It Works
        </h2>

        {/* Main Content Card with Integrated Navigation */}
        <div
          ref={ref}
          className={`max-w-6xl mx-auto relative transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
          style={{
            transform: `translateY(${(1 - scrollProgress) * 20}px)`
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden transition-all duration-500 hover:shadow-3xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[500px]">
              {/* Left Content */}
              <div className="p-8 lg:p-12 flex flex-col justify-center">
                <h3 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-6 transition-all duration-500">
                  {currentStepData.title}
                </h3>
                <p className="text-gray-600 text-lg mb-8 leading-relaxed transition-all duration-500">
                  {currentStepData.description}
                </p>
              </div>

              {/* Right Visual */}
              <div className="bg-gray-50 p-8 lg:p-12 flex items-center justify-center">
                <div className="w-full max-w-md transition-all duration-500 hover:scale-105">
                  {currentStepData.content}
                </div>
              </div>
            </div>
          </div>

          {/* Left Navigation Arrow */}
          <button
            onClick={prevStep}
            className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/80 hover:bg-black transition-all duration-300 text-white shadow-lg backdrop-blur-sm hover:scale-110 ${
              isHovered
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-2'
            }`}
            aria-label="Previous step"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {/* Right Navigation Arrow */}
          <button
            onClick={nextStep}
            className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/80 hover:bg-black transition-all duration-300 text-white shadow-lg backdrop-blur-sm hover:scale-110 ${
              isHovered
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 translate-x-2'
            }`}
            aria-label="Next step"
          >
            <ArrowRight className="h-5 w-5" />
          </button>

          {/* Step Indicators */}
          <div className="flex justify-center mt-6 gap-2">
            {flowSteps.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={`h-2 rounded-full transition-all duration-300 hover:scale-125 ${
                  index === currentStep
                    ? 'bg-white w-8 shadow-lg'
                    : 'bg-white/30 w-2 hover:bg-white/50'
                }`}
                aria-label={`Go to step ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const NWCSupportersSection = () => {
  const { ref, isVisible } = useScrollAnimation()
  const supporters = [
    {
      name: 'Alby',
      logo: '/placeholder.svg?height=60&width=120&text=Alby',
      color: 'bg-yellow-500'
    },
    {
      name: 'Primal',
      logo: '/placeholder.svg?height=60&width=120&text=Primal',
      color: 'bg-purple-500'
    },
    {
      name: 'Flash',
      logo: '/placeholder.svg?height=60&width=120&text=Flash',
      color: 'bg-blue-500'
    },
    {
      name: 'BTCCuracao',
      logo: '/placeholder.svg?height=60&width=120&text=BTCCuracao',
      color: 'bg-orange-500'
    },
    {
      name: 'Geyser Fund',
      logo: '/placeholder.svg?height=60&width=120&text=Geyser+Fund',
      color: 'bg-green-500'
    }
  ]

  return (
    <section className="py-16 sm:py-20">
      <div ref={ref} className="container mx-auto px-4 text-center">
        <h2
          className={`text-2xl md:text-3xl font-bold tracking-tight text-white mb-4 transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          NWC Supporters
        </h2>
        <p
          className={`text-gray-400 mb-12 max-w-2xl mx-auto transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Trusted by leading Lightning wallets and Bitcoin organizations
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 items-center justify-items-center">
          {supporters.map((supporter, index) => (
            <div
              key={supporter.name}
              className={`group flex flex-col items-center gap-3 p-4 rounded-lg hover:bg-white/5 transition-all duration-500 hover:scale-110 hover:-translate-y-2 ${
                isVisible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-8'
              }`}
              style={{
                transitionDelay: isVisible ? `${index * 100 + 400}ms` : '0ms'
              }}
            >
              <div className="relative overflow-hidden rounded-lg bg-white/10 p-4 group-hover:bg-white/20 transition-all duration-300 group-hover:rotate-3">
                <img
                  src={supporter.logo || '/placeholder.svg'}
                  alt={`${supporter.name} logo`}
                  className="h-12 w-auto object-contain filter brightness-0 invert opacity-80 group-hover:opacity-100 transition-all duration-300"
                />
              </div>
              <span className="text-sm text-gray-400 group-hover:text-white transition-colors duration-300">
                {supporter.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const OpenSourceSection = () => {
  const [activeTab, setActiveTab] = React.useState('standards')
  const { ref, isVisible } = useScrollAnimation()

  const StandardsLogo = ({
    Icon,
    name
  }: {
    Icon: React.ComponentType<LucideProps>
    name: string
  }) => (
    <div className="flex flex-col items-center gap-2 text-gray-400 hover:text-white transition-all duration-300 hover:scale-110 hover:-translate-y-1">
      <Icon className="h-10 w-10" />
      <span className="text-sm">{name}</span>
    </div>
  )

  const TechLogo = ({ name }: { name: string }) => (
    <div className="flex flex-col items-center gap-2 text-gray-400 hover:text-white transition-all duration-300 hover:scale-110 hover:-translate-y-1">
      <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
        <span className="text-xs font-bold">
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>
      <span className="text-sm">{name}</span>
    </div>
  )

  return (
    <section className="py-20 sm:py-24">
      <div ref={ref} className="container mx-auto px-4 text-center">
        <h2
          className={`text-3xl md:text-4xl font-bold tracking-tight text-white mb-8 transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          100% Open Source
        </h2>

        {/* Tab Navigation */}
        <div
          className={`flex justify-center mb-12 transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="bg-white/10 rounded-full p-1 backdrop-blur-sm">
            <button
              onClick={() => setActiveTab('standards')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 hover:scale-105 ${
                activeTab === 'standards'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-white hover:text-gray-300'
              }`}
            >
              Open Standards
            </button>
            <button
              onClick={() => setActiveTab('tech')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 hover:scale-105 ${
                activeTab === 'tech'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-white hover:text-gray-300'
              }`}
            >
              Tech Stack
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div
          className={`mt-12 transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {activeTab === 'standards' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 animate-fade-in">
              <StandardsLogo Icon={Wallet} name="NWC" />
              <StandardsLogo Icon={Nfc} name="BoltCard" />
              <StandardsLogo Icon={LinkIcon} name="LUD-16" />
              <StandardsLogo Icon={LinkIcon} name="LUD-21" />
              <StandardsLogo Icon={Cpu} name="NIP-46" />
              <StandardsLogo Icon={Cpu} name="NIP-07" />
            </div>
          )}

          {activeTab === 'tech' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 animate-fade-in">
              <TechLogo name="TypeScript" />
              <TechLogo name="React" />
              <TechLogo name="Tailwind" />
              <TechLogo name="shadcn" />
              <TechLogo name="Prisma" />
              <TechLogo name="Nostrify" />
            </div>
          )}
        </div>

        <p
          className={`mt-12 font-accent text-4xl md:text-5xl text-nwc-highlight transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Interoperability or death.
        </p>
        <Button
          size="lg"
          className={`mt-8 rounded-full bg-white text-black hover:bg-gray-200 transition-all duration-300 shadow-lg hover:shadow-nwc-purple/20 hover:scale-105 hover:-translate-y-1 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: isVisible ? '800ms' : '0ms' }}
          asChild
        >
          <a
            href="https://github.com/agustinkassis/boltcard-nwc"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="mr-2 h-5 w-5" /> View Code on GitHub
          </a>
        </Button>
      </div>
    </section>
  )
}

const roadmapItems = [
  {
    title: 'BoltCard',
    description: 'NTAG424 payments',
    status: 'completed',
    icon: Nfc
  },
  {
    title: 'NWC',
    description: 'Nostr Wallet Connect backend',
    status: 'completed',
    icon: Cpu
  },
  {
    title: 'Wallet',
    description: 'Integrated webapp wallet',
    status: 'in_progress',
    icon: Wallet
  },
  {
    title: 'Pay with Phone',
    description: 'NFC from mobile with dynamic NWC',
    status: 'in_progress',
    icon: SmartphoneNfc
  }
]

const RoadmapSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="py-20 sm:py-24">
      <div ref={ref} className="container mx-auto px-4">
        <h2
          className={`text-center text-3xl md:text-4xl font-bold tracking-tight text-white mb-16 transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Roadmap
        </h2>

        {/* Timeline Container */}
        <div className="relative max-w-6xl mx-auto">
          {/* Vertical Line */}
          <div
            className={`absolute left-1/2 transform -translate-x-1/2 w-1 h-full bg-gradient-to-b from-nwc-purple via-nwc-orange to-nwc-highlight transition-all duration-1500 delay-300 ${
              isVisible ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'
            }`}
            style={{ transformOrigin: 'top' }}
          ></div>

          {/* Timeline Items */}
          <div className="space-y-20">
            {roadmapItems.map((item, index) => (
              <div
                key={item.title}
                className={`relative flex flex-col md:flex-row items-center transition-all duration-1000 \
                  ${index % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} \
                  ${isVisible ? 'opacity-100 translate-x-0' : `opacity-0 ${index % 2 === 0 ? '-translate-x-8' : 'translate-x-8'}`}
                `}
                style={{
                  transitionDelay: isVisible ? `${index * 200 + 600}ms` : '0ms'
                }}
              >
                {/* Timeline Icon */}
                <div
                  className={`z-20 w-16 h-16 rounded-full bg-gray-900 border-4 border-white flex items-center justify-center transition-all duration-700 hover:scale-110 \
                    ${isVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'} \
                    md:absolute md:left-1/2 md:top-1/2 md:transform md:-translate-x-1/2 md:-translate-y-1/2 \
                    absolute top-0 left-1/2 -translate-x-1/2 \
                  `}
                  style={{
                    transitionDelay: isVisible
                      ? `${index * 200 + 800}ms`
                      : '0ms'
                  }}
                >
                  {item.icon && (
                    <item.icon className="h-8 w-8 text-nwc-highlight" />
                  )}
                </div>

                {/* Content Card */}
                <div
                  className={`w-full md:w-5/12 mt-8 md:mt-0 \
                    ${index % 2 === 0 ? 'self-start items-start text-left md:pr-8' : 'self-end items-end text-right md:pl-8'} \
                    flex flex-col md:items-stretch \
                  `}
                >
                  <Card className="bg-white/5 backdrop-blur-md border-white/10 shadow-lg hover:bg-white/10 transition-all duration-300 hover:scale-105 hover:-translate-y-2 w-full">
                    <CardContent className="p-6">
                      <div
                        className={`flex items-center gap-3 mb-2 ${index % 2 === 0 ? 'justify-start text-left' : 'justify-end text-right'}`}
                      >
                        {index % 2 === 0 ? (
                          <>
                            <h3 className="text-xl font-semibold text-white">
                              {item.title}
                            </h3>
                            <div
                              className={`px-2 py-1 rounded-full text-xs font-medium transition-all duration-300 \
                                ${item.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}
                              `}
                            >
                              {item.status === 'completed'
                                ? 'Completed'
                                : 'In Progress'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className={`px-2 py-1 rounded-full text-xs font-medium transition-all duration-300 \
                                ${item.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}
                              `}
                            >
                              {item.status === 'completed'
                                ? 'Completed'
                                : 'In Progress'}
                            </div>
                            <h3 className="text-xl font-semibold text-white">
                              {item.title}
                            </h3>
                          </>
                        )}
                      </div>
                      <p
                        className={`text-gray-400 ${index % 2 === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {item.description}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Spacer for opposite side on desktop */}
                <div className="hidden md:block w-5/12"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const WaitlistSection = () => {
  const { ref, isVisible } = useScrollAnimation()
  const [email, setEmail] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isSuccess, setIsSuccess] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Reset states
    setError('')
    setIsSubmitting(true)

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      setError('Please enter a valid email address')
      setIsSubmitting(false)
      return
    }

    // Simulate API call
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)) // 2 second delay

      // Simulate success
      setIsSuccess(true)
      setEmail('')
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setIsSuccess(false)
    setError('')
    setEmail('')
  }

  if (isSuccess) {
    return (
      <section id="waitlist-section" className="py-20 sm:py-24">
        <div ref={ref} className="container mx-auto px-4 text-center">
          <div
            className={`max-w-md mx-auto transition-all duration-1000 ${
              isVisible
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 translate-y-8 scale-95'
            }`}
          >
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-8 backdrop-blur-sm">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
                You&apos;re on the list! 🎉
              </h2>
              <p className="text-gray-300 mb-6">
                Thanks for joining our waitlist. We&apos;ll notify you as soon
                as BoltCard + NWC is ready to launch.
              </p>
              <Button
                onClick={resetForm}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10 transition-all duration-300 bg-transparent"
              >
                Join Another Email
              </Button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id="waitlist-section" className="py-20 sm:py-24">
      <div ref={ref} className="container mx-auto px-4 text-center">
        <h2
          className={`text-3xl md:text-4xl font-bold tracking-tight text-white transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Join the waitlist
        </h2>
        <p
          className={`mt-4 max-w-xl mx-auto text-gray-400 transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Be the first to know when we launch. Get early access and updates.
        </p>
        <form
          onSubmit={handleSubmit}
          className={`mt-8 max-w-md mx-auto transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="relative">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isSubmitting}
              className={`h-14 pl-6 pr-36 rounded-full bg-white/10 border-white/20 focus:ring-2 focus:ring-nwc-purple text-white placeholder:text-gray-500 transition-all duration-300 focus:scale-105 ${
                error ? 'border-red-500/50 focus:ring-red-500' : ''
              } ${isSubmitting ? 'opacity-50' : ''}`}
              aria-label="Email for waitlist"
            />
            <Button
              type="submit"
              disabled={isSubmitting || !email}
              className={`absolute top-1.5 right-1.5 h-11 rounded-full px-6 bg-nwc-purple hover:bg-nwc-purple/90 text-white transition-all duration-300 ease-in-out shadow-md hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                isSubmitting ? 'animate-pulse' : ''
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Joining...
                </>
              ) : (
                <>
                  Join <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-red-400 text-sm animate-fade-in">{error}</p>
          )}
        </form>
      </div>
    </section>
  )
}

const Footer = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <footer className="py-8 border-t border-white/10">
      <div
        ref={ref}
        className={`container mx-auto px-4 text-center text-gray-500 text-sm transition-all duration-1000 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        &copy; {new Date().getFullYear()} BoltCard + NWC. All Rights Reserved.
      </div>
    </footer>
  )
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen w-full">
      <AnimatedBackground />
      <div className="relative z-10 flex flex-col">
        <Header />
        <main>
          <HeroSection />
          <FlowSection />
          <NWCSupportersSection />
          <OpenSourceSection />
          <RoadmapSection />
          <WaitlistSection />
        </main>
        <Footer />
      </div>
    </div>
  )
}
