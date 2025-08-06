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
  <header className="sticky top-0 z-50 py-4 px-4 bg-black/50 backdrop-blur-lg border-b border-white/10 animate-fade-in-down">
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
          className={`text-4xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 transition-all duration-1200 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          BoltCard meets NWC
        </h1>
        <p
          className={`mt-8 max-w-3xl mx-auto text-xl text-gray-300 leading-relaxed font-light transition-all duration-1000 delay-400 ${
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
          className={`mt-12 flex flex-col gap-4 justify-center items-center transition-all duration-1000 delay-600 ${
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
          {/* <div className="flex flex-col sm:flex-row gap-4">
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
          </div> */}
        </div>
      </div>
    </section>
  )
}

const flowSteps = [
  {
    title: '1. Create a new card',
    description:
      'In your admin dashboard, first add the available designs and then create a new card.',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step1.png"
          alt="Step 1: Create a new card"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
      </div>
    )
  },
  {
    title: '2. Write to NFC Chip',
    description:
      'Scan NFC chip and then write it with Bolt Card NFC Card Creator App.',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step2.png"
          alt="Step 2: Write the NFC Card"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
      </div>
    )
  },
  {
    title: '3. Print Setup QR',
    description:
      'Print the QR or send the auto-generated link and give it to the user.',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step3.png"
          alt="Step 3: Print activation QR code"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
      </div>
    )
  },
  {
    title: '4. End user scans QR',
    description:
      'User scans the QR, opens a webapp and creates a new wallet (linked to the card).',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step4.png"
          alt="Step 4: Users scans QR code and open"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
      </div>
    )
  },
  {
    title: '5. Setup in 20 seconds',
    description: 'Users sets a lightning address and a NWC connection string.',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step5.png"
          alt="Step 5: Set lightning address and NWC connection string"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
      </div>
    )
  },
  {
    title: '6. Receive and Send payments',
    description:
      'The card is ready! Tap on any compatible POS to make a Lightning payment via NWC.',
    content: (
      <div className="w-full rounded-lg flex flex-col">
        <img
          src="/steps/step6.png"
          alt="Step 6: Receive lightning address and tap with NWC"
          className="w-full h-full object-contain rounded-lg border-none"
          style={{ minHeight: '180px' }}
        />
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
          className={`text-center text-3xl font-bold tracking-tight text-white mb-16 transition-all duration-1000 ${
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
            <div className="grid grid-cols-1 min-h-[500px]">
              {/* Left Content */}
              <div className="p-8 flex flex-col justify-center">
                <h3 className="text-3xl font-bold text-gray-900 mb-6 transition-all duration-500">
                  {currentStepData.title}
                </h3>
                <p className="text-gray-600 text-lg mb-8 leading-relaxed transition-all duration-500">
                  {currentStepData.description}
                </p>
              </div>

              {/* Right Visual */}
              <div className="bg-gray-50 p-8 flex items-center justify-center">
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
      logo: '/logos/alby.png',
      color: 'bg-yellow-500'
    },
    {
      name: 'Primal',
      logo: '/logos/primal.png',
      color: 'bg-purple-500'
    },
    {
      name: 'Flash',
      logo: '/logos/flash.png',
      color: 'bg-blue-500'
    },
    {
      name: 'BTCCuracao',
      logo: '/logos/curacao.png',
      color: 'bg-orange-500'
    },
    {
      name: 'Geyser Fund',
      logo: '/logos/geyser.png',
      color: 'bg-green-500'
    }
  ]

  return (
    <section className="py-16 sm:py-20">
      <div ref={ref} className="container mx-auto px-4 text-center">
        <h2
          className={`text-2xl font-bold tracking-tight text-white mb-4 transition-all duration-1000 ${
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
        <div className="grid grid-cols-2 gap-8 items-center justify-items-center">
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
                  className="h-12 w-auto object-contain opacity-80 group-hover:opacity-100 transition-all duration-300"
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
          className={`text-3xl font-bold tracking-tight text-white mb-8 transition-all duration-1000 ${
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
            <div className="grid grid-cols-2 gap-8 animate-fade-in">
              <StandardsLogo Icon={Wallet} name="NWC" />
              <StandardsLogo Icon={Nfc} name="BoltCard" />
              <StandardsLogo Icon={LinkIcon} name="LUD-16" />
              <StandardsLogo Icon={LinkIcon} name="LUD-21" />
              <StandardsLogo Icon={Cpu} name="NIP-46" />
              <StandardsLogo Icon={Cpu} name="NIP-07" />
            </div>
          )}

          {activeTab === 'tech' && (
            <div className="grid grid-cols-2 gap-8 animate-fade-in">
              <TechLogo name="TypeScript" />
              <TechLogo name="React" />
              <TechLogo name="Tailwind" />
              <TechLogo name="shadcn" />
              <TechLogo name="Prisma" />
              <TechLogo name="Alby SDK" />
            </div>
          )}
        </div>

        <p
          className={`mt-12 font-accent text-4xl text-nwc-highlight transition-all duration-1000 delay-600 ${
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
          className={`text-center text-3xl font-bold tracking-tight text-white mb-16 transition-all duration-1000 ${
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
                className={`relative flex flex-col items-center transition-all duration-1000 \
                  ${isVisible ? 'opacity-100 translate-x-0' : `opacity-0 ${index % 2 === 0 ? '-translate-x-8' : 'translate-x-8'}`}
                `}
                style={{
                  transitionDelay: isVisible ? `${index * 200 + 600}ms` : '0ms'
                }}
              >
                {/* Timeline Icon */}
                <div
                  className={`z-20 w-12 h-12 rounded-full bg-gray-900 border-2 border-white flex items-center justify-center transition-all duration-700 hover:scale-110 \
                    ${isVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'} \
                    absolute top-0 left-1/2 -translate-x-1/2 \
                  `}
                  style={{
                    transitionDelay: isVisible
                      ? `${index * 200 + 800}ms`
                      : '0ms'
                  }}
                >
                  {item.icon && (
                    <item.icon className="h-4 w-4 text-nwc-highlight" />
                  )}
                </div>

                {/* Content Card */}
                <div
                  className={`w-full mt-8 flex flex-col`}
                >
                  <Card className="bg-white/5 backdrop-blur-md border-white/10 shadow-lg hover:bg-white/10 transition-all duration-300  w-full">
                    <CardContent className="p-6">
                      <div
                        className={`flex items-center gap-3 mb-2`}
                      >
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
                      </div>
                      <p
                        className={`text-left text-gray-400`}
                      >
                        {item.description}
                      </p>
                    </CardContent>
                  </Card>
                </div>
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

    setError('')
    setIsSubmitting(true)

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      setError('Please enter a valid email address')
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email }) // add name if you want to collect it
      })
      const data = await response.json()
      if (data.success) {
        setIsSuccess(true)
        setEmail('')
      } else {
        setError(data.error || 'Subscription failed. Please try again.')
      }
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
