'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Github,
  Check,
  Nfc,
  Wallet,
  Cpu,
  ArrowRight,
  ArrowLeft,
  SmartphoneNfc,
  PanelTopDashed,
  Zap,
  Shield,
  Globe,
  Code2,
  ExternalLink,
  Terminal,
  Hash,
  Key,
  Radio,
  Users,
  MessageSquare,
  Server,
  Cloud,
  HardDrive,
  Mail,
  AtSign
} from 'lucide-react'
import Link from 'next/link'

// ─── Hooks ──────────────────────────────────────────────────────────────────

const useScrollAnimation = (threshold = 0.1, rootMargin = '50px') => {
  const [isVisible, setIsVisible] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true)
      },
      { threshold, rootMargin }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return { ref, isVisible }
}

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

// ─── Animated Background ────────────────────────────────────────────────────

const AnimatedBackground = () => (
  <div className="fixed inset-0 -z-10 h-full w-full overflow-hidden bg-lw-dark">
    <div className="absolute inset-0 grid-pattern" />
    <div className="absolute left-[-15rem] top-[-8rem] h-[35rem] w-[35rem] rounded-full bg-lw-gold/8 blur-[150px] animate-[gradient-move_20s_ease-in-out_infinite]" />
    <div className="absolute right-[-10rem] top-[10rem] h-[30rem] w-[30rem] rounded-full bg-lw-teal/10 blur-[130px] animate-[gradient-move_24s_ease-in-out_infinite_3s]" />
    <div className="absolute bottom-[-8rem] left-[20%] h-[25rem] w-[35rem] rounded-full bg-nwc-purple/6 blur-[120px] animate-[gradient-move_22s_ease-in-out_infinite_6s]" />
    <div className="absolute bottom-[20%] right-[-5rem] h-[20rem] w-[20rem] rounded-full bg-lw-coral/5 blur-[100px] animate-[gradient-move_18s_ease-in-out_infinite_9s]" />
  </div>
)

// ─── Header ─────────────────────────────────────────────────────────────────

const Header = () => {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 py-3 px-4 backdrop-blur-xl border-b transition-all duration-500 animate-fade-in-down ${
        scrolled
          ? 'bg-lw-dark/80 border-lw-gold/10 shadow-lg shadow-lw-dark/50'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src="/logos/lawallet.svg" alt="LaWallet" className="h-6 w-auto opacity-90" />
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Features
          </a>
          <a href="#deploy" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Deploy
          </a>
          <a href="#nfc-cards" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            NFC Cards
          </a>
          <a href="#roadmap" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Roadmap
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60 hover:text-white hover:bg-white/5 transition-all duration-300"
            asChild
          >
            <a
              href="https://github.com/lawalletio/lawallet-nwc"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}

// ─── Hero Section ───────────────────────────────────────────────────────────

const HeroSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="relative pt-16 pb-8 sm:pt-28 sm:pb-16 overflow-hidden">
      <div ref={ref} className="max-w-5xl mx-auto px-4 text-center relative z-10">
        {/* Protocol badges */}
        <div
          className={`flex flex-wrap justify-center gap-2 mb-8 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {['Lightning', 'Nostr', 'NWC', 'Open Source'].map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border border-lw-gold/20 text-lw-gold/70 bg-lw-gold/5"
            >
              <Zap className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>

        {/* Main headline */}
        <h1
          className={`text-5xl sm:text-7xl md:text-8xl font-black tracking-tight leading-[0.9] transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          <span className="text-gradient-gold">Lightning addresses</span>
          <br />
          <span className="text-white">for everyone.</span>
        </h1>

        {/* Subheadline */}
        <p
          className={`mt-8 max-w-2xl mx-auto text-lg sm:text-xl text-white/50 leading-relaxed font-light transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          The open-source{' '}
          <span className="text-lw-gold font-medium">Lightning + Nostr CRM</span>{' '}
          for communities and companies.
          <br className="hidden sm:block" />
          Connect your domain. Deploy in minutes. Your users get{' '}
          <span className="text-lw-teal font-medium">addresses, wallets, and identity</span> — instantly.
        </p>

        {/* CTA Buttons */}
        <div
          className={`mt-10 flex flex-col sm:flex-row gap-3 justify-center items-center transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <Button
            size="lg"
            className="group px-8 py-5 rounded-full bg-lw-gold hover:bg-lw-gold/90 text-black font-semibold transition-all duration-300 shadow-lg shadow-lw-gold/20 hover:shadow-lw-gold/30 hover:scale-105"
            onClick={() =>
              document.getElementById('waitlist-section')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            Get Early Access
            <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
          <div className="flex gap-3">
            <Link href="/admin">
              <Button
                size="lg"
                variant="outline"
                className="px-6 py-5 rounded-full bg-transparent border-white/10 text-white/70 hover:text-white hover:bg-white/5 hover:border-lw-teal/30 transition-all duration-300"
              >
                <PanelTopDashed className="mr-2 h-4 w-4" />
                Admin Demo
              </Button>
            </Link>
            <Link href="/wallet">
              <Button
                size="lg"
                variant="outline"
                className="px-6 py-5 rounded-full bg-transparent border-white/10 text-white/70 hover:text-white hover:bg-white/5 hover:border-lw-gold/30 transition-all duration-300"
              >
                <Wallet className="mr-2 h-4 w-4" />
                Wallet Demo
              </Button>
            </Link>
          </div>
        </div>

        {/* Domain example */}
        <div
          className={`mt-12 inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] transition-all duration-1000 delay-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <AtSign className="h-4 w-4 text-lw-teal" />
          <span className="font-mono text-sm text-white/50">
            <span className="text-lw-gold">alice</span>
            <span className="text-white/30">@</span>
            <span className="text-lw-teal">yourdomain.com</span>
          </span>
          <Zap className="h-3.5 w-3.5 text-lw-gold/40" />
        </div>
      </div>
    </section>
  )
}

// ─── Scrolling Tech Strip ───────────────────────────────────────────────────

const TechStrip = () => {
  const items = [
    'Lightning Address', 'Nostr Identity', 'NWC', 'BoltCard', 'NIP-47', 'NIP-05',
    'NIP-46', 'LUD-16', 'LUD-21', 'NIP-57 Zaps', 'Vercel Deploy', 'Docker',
    'Lightning Address', 'Nostr Identity', 'NWC', 'BoltCard', 'NIP-47', 'NIP-05',
    'NIP-46', 'LUD-16', 'LUD-21', 'NIP-57 Zaps', 'Vercel Deploy', 'Docker'
  ]

  return (
    <div className="relative py-6 overflow-hidden border-y border-white/[0.04]">
      <div className="animate-marquee marquee-track flex gap-8 whitespace-nowrap">
        {items.map((item, i) => (
          <span
            key={i}
            className="text-sm font-mono text-white/15 flex items-center gap-2"
          >
            <span className="text-lw-gold/30">&#x26A1;</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Features Section ───────────────────────────────────────────────────────

const features = [
  {
    icon: Zap,
    title: 'Lightning Addresses',
    description:
      'Give every user a lightning address on your domain. alice@yourdomain.com — receive payments, zaps, and tips instantly.',
    color: 'lw-gold'
  },
  {
    icon: Users,
    title: 'Nostr-Native CRM',
    description:
      'Manage your community with user profiles, activity tracking, segmentation, and Nostr-powered communication built in.',
    color: 'nwc-purple'
  },
  {
    icon: Radio,
    title: 'NWC Integration',
    description:
      'Progressive self-custody. Users start with zero friction, then connect their own NWC wallet when ready. Sovereignty is a journey.',
    color: 'lw-teal'
  },
  {
    icon: Nfc,
    title: 'BoltCard / NFC',
    description:
      'Program NTAG424 cards as BoltCards. Tap any compatible POS to pay with Lightning — physical cards for your community.',
    color: 'lw-coral'
  },
  {
    icon: Cloud,
    title: 'Deploy Anywhere',
    description:
      'One-click deploy on Vercel. Docker for your server. Umbrel or Start9 for your node. Your infrastructure, your choice.',
    color: 'lw-gold'
  },
  {
    icon: Code2,
    title: 'Open Source, FOREVER',
    description:
      'MIT licensed. No open-core tricks. No proprietary features behind a paywall. Fork it, hack it, deploy it. The community owns this.',
    color: 'lw-teal'
  }
]

const colorMap: Record<string, string> = {
  'lw-gold': 'text-lw-gold',
  'nwc-purple': 'text-nwc-purple',
  'lw-teal': 'text-lw-teal',
  'lw-coral': 'text-lw-coral'
}

const bgColorMap: Record<string, string> = {
  'lw-gold': 'bg-lw-gold/10',
  'nwc-purple': 'bg-nwc-purple/10',
  'lw-teal': 'bg-lw-teal/10',
  'lw-coral': 'bg-lw-coral/10'
}

const gradientBgMap: Record<string, string> = {
  'lw-gold': 'bg-gradient-to-br from-lw-gold/15 via-lw-gold/5 to-lw-dark',
  'nwc-purple': 'bg-gradient-to-br from-nwc-purple/15 via-nwc-purple/5 to-lw-dark',
  'lw-teal': 'bg-gradient-to-br from-lw-teal/15 via-lw-teal/5 to-lw-dark',
  'lw-coral': 'bg-gradient-to-br from-lw-coral/15 via-lw-coral/5 to-lw-dark'
}

const FeaturesSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="features" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-teal mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Features'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            A CRM with Lightning and Nostr
            <br />
            <span className="text-gradient-gold">built in, not bolted on</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`glow-card group relative overflow-hidden rounded-2xl border border-white/[0.06] transition-all duration-500 hover:-translate-y-1 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{
                transitionDelay: isVisible ? `${index * 100 + 200}ms` : '0ms'
              }}
            >
              {/* Full-card gradient background */}
              <div className={`absolute inset-0 ${gradientBgMap[feature.color]}`} />
              <div className="absolute inset-0 bg-gradient-to-t from-lw-dark via-lw-dark/50 to-transparent" />

              {/* Large icon visual */}
              <div className="relative flex items-center justify-center pt-12 pb-8">
                <div
                  className={`absolute w-28 h-28 rounded-full ${bgColorMap[feature.color]} blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500`}
                />
                <feature.icon
                  className={`relative h-16 w-16 ${colorMap[feature.color]} opacity-30 group-hover:opacity-60 group-hover:scale-110 transition-all duration-500`}
                />
              </div>

              {/* Content at bottom */}
              <div className="relative px-6 pb-6">
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed overflow-hidden transition-all duration-300 mt-2 md:max-h-0 md:opacity-0 md:mt-0 md:group-hover:max-h-28 md:group-hover:opacity-100 md:group-hover:mt-2">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Deploy Section ─────────────────────────────────────────────────────────

const deployOptions = [
  {
    logo: '/logos/vercel.svg',
    title: 'Vercel',
    time: '2 min',
    description: 'One-click deploy. Perfect for communities that want to be live instantly.',
    command: 'npx vercel deploy'
  },
  {
    logo: '/logos/docker.svg',
    title: 'Docker',
    time: '5 min',
    description: 'Compose file included. Run on any VPS or server you control.',
    command: 'docker compose up -d'
  },
  {
    logo: '/logos/umbrel.svg',
    title: 'Your Node',
    time: '5 min',
    description: 'Umbrel, Start9, or bare metal. Full sovereignty on your own hardware.',
    command: 'lawallet-nwc start'
  }
]

const DeploySection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="deploy" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-gold mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Deploy'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Connect your domain.
            <br />
            <span className="text-gradient-gold">Be live in minutes.</span>
          </h2>
          <p
            className={`mt-4 text-white/30 max-w-xl mx-auto transition-all duration-1000 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Choose your deployment path. From instant cloud to full sovereignty.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {deployOptions.map((option, index) => (
            <div
              key={option.title}
              className={`glow-card group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 hover:bg-white/[0.04] transition-all duration-500 hover:-translate-y-1 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{
                transitionDelay: isVisible ? `${index * 150 + 200}ms` : '0ms'
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-lw-gold/10 flex items-center justify-center">
                  <img src={option.logo} alt={`${option.title} logo`} className="h-5 w-auto opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                <span className="text-xs font-mono text-lw-teal bg-lw-teal/10 px-2.5 py-1 rounded-full">
                  ~{option.time}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{option.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed mb-4">{option.description}</p>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04] font-mono text-xs text-white/30">
                <Terminal className="h-3 w-3 text-lw-teal flex-shrink-0" />
                <span className="text-lw-teal">$</span> {option.command}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── How It Works / NFC Cards ───────────────────────────────────────────────

const flowSteps = [
  'Create a new card',
  'Write to NFC chip',
  'Print setup QR',
  'User scans QR',
  'Setup in 20 seconds',
  'Send & receive payments'
]

const floatingCards = [
  { src: '/card-primal.png', alt: 'Primal NFC Card', left: '25%', top: '5%', z: 5, tilt: 'rotateY(-6deg) rotateX(4deg)', anim: 'nfc-float-2', dur: '10s', delay: '0s', width: 'w-36 sm:w-48 md:w-60' },
  { src: '/card-alby.png', alt: 'Alby NFC Card', left: '0%', top: '25%', z: 3, tilt: 'rotateY(14deg) rotateX(-5deg)', anim: 'nfc-float-1', dur: '8.5s', delay: '1s', width: 'w-32 sm:w-40 md:w-48' },
  { src: '/card-flash.png', alt: 'Flash NFC Card', left: '52%', top: '12%', z: 4, tilt: 'rotateY(-14deg) rotateX(3deg)', anim: 'nfc-float-3', dur: '9s', delay: '0.5s', width: 'w-32 sm:w-44 md:w-52' },
  { src: '/card-geyser.png', alt: 'Geyser NFC Card', left: '65%', top: '52%', z: 3, tilt: 'rotateY(8deg) rotateX(-4deg)', anim: 'nfc-float-4', dur: '10.5s', delay: '2.5s', width: 'w-28 sm:w-36 md:w-44' },
  { src: '/card-curacao.png', alt: 'BTC Curacao NFC Card', left: '72%', top: '2%', z: 2, tilt: 'rotateY(-18deg) rotateX(6deg)', anim: 'nfc-float-1', dur: '9.5s', delay: '1.5s', width: 'w-28 sm:w-36 md:w-44' },
  { src: '/card-bg-1.png', alt: 'Custom NFC Card', left: '5%', top: '60%', z: 2, tilt: 'rotateY(12deg) rotateX(7deg)', anim: 'nfc-float-4', dur: '11s', delay: '2s', width: 'w-28 sm:w-36 md:w-44' },
  { src: '/card-bg-5.png', alt: 'Custom NFC Card', left: '38%', top: '55%', z: 2, tilt: 'rotateY(-8deg) rotateX(-6deg)', anim: 'nfc-float-2', dur: '12s', delay: '3s', width: 'w-28 sm:w-40 md:w-48' }
]

const FlowSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="nfc-cards" className="py-20 sm:py-28 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12 sm:mb-16">
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

        {/* Floating 3D Cards Showcase */}
        <div
          ref={ref}
          className={`relative h-[320px] sm:h-[420px] md:h-[500px] mx-auto max-w-4xl overflow-hidden rounded-3xl transition-all duration-1000 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
          style={{ perspective: '1200px' }}
        >
          {/* Ambient glow */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-96 h-56 bg-lw-gold/8 blur-[120px] rounded-full" />
          </div>
          <div className="absolute top-1/4 left-1/4 pointer-events-none">
            <div className="w-48 h-48 bg-nwc-purple/6 blur-[80px] rounded-full" />
          </div>
          <div className="absolute bottom-1/4 right-1/4 pointer-events-none">
            <div className="w-40 h-40 bg-lw-teal/6 blur-[80px] rounded-full" />
          </div>

          {floatingCards.map((card) => (
            <div
              key={card.src}
              className="absolute"
              style={{
                left: card.left,
                top: card.top,
                zIndex: card.z
              }}
            >
              <div
                className="will-change-transform"
                style={{
                  animation: `${card.anim} ${card.dur} ease-in-out infinite`,
                  animationDelay: card.delay
                }}
              >
                <div style={{ transform: card.tilt, transformStyle: 'preserve-3d' }}>
                  <img
                    src={card.src}
                    alt={card.alt}
                    className={`${card.width} h-auto rounded-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5),0_4px_25px_-5px_rgba(0,0,0,0.3)] border border-white/10 pointer-events-none select-none`}
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Compact BoltCard Flow Steps */}
        <div
          className={`mt-14 sm:mt-16 max-w-4xl mx-auto grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-6 transition-all duration-1000 delay-500 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {flowSteps.map((step, index) => (
            <div key={step} className="text-center group">
              <div className="w-8 h-8 rounded-full bg-lw-gold/10 border border-lw-gold/20 text-lw-gold text-xs font-mono flex items-center justify-center mx-auto mb-2.5 group-hover:bg-lw-gold/20 group-hover:border-lw-gold/40 transition-colors duration-300">
                {index + 1}
              </div>
              <p className="text-xs font-medium text-white/40 group-hover:text-white/70 transition-colors duration-300 leading-tight">
                {step}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Open Source Section ────────────────────────────────────────────────────

const protocols = [
  { icon: Radio, name: 'NWC', label: 'NIP-47' },
  { icon: Nfc, name: 'BoltCard', label: 'NTAG424' },
  { icon: Zap, name: 'LUD-16', label: 'Lightning Address' },
  { icon: Zap, name: 'LUD-21', label: 'Verification' },
  { icon: Hash, name: 'NIP-05', label: 'Nostr Identity' },
  { icon: Key, name: 'NIP-46', label: 'Remote Signing' },
  { icon: MessageSquare, name: 'NIP-04', label: 'Encrypted DMs' },
  { icon: Mail, name: 'NIP-57', label: 'Zaps' },
  { icon: Shield, name: 'LUD-22', label: 'Webhooks' }
]

const techStack = [
  'TypeScript',
  'Next.js',
  'React',
  'Tailwind CSS',
  'Prisma',
  'PostgreSQL'
]

const OpenSourceSection = () => {
  const [activeTab, setActiveTab] = React.useState<'protocols' | 'stack'>('protocols')
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="py-20 sm:py-28">
      <div ref={ref} className="max-w-5xl mx-auto px-4 text-center">
        <span
          className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-teal mb-4 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {'// Open Standards'}
        </span>
        <h2
          className={`text-3xl sm:text-5xl font-bold text-white tracking-tight mb-4 transition-all duration-1000 delay-100 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          100% open source.{' '}
          <span className="text-gradient-teal">FOREVER.</span>
        </h2>
        <p
          className={`text-white/30 max-w-xl mx-auto mb-12 transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          No vendor lock-in. No open-core tricks. No proprietary features behind a paywall. Everything is auditable.
        </p>

        <div
          className={`flex justify-center mb-10 transition-all duration-1000 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="inline-flex rounded-full border border-white/[0.06] bg-white/[0.02] p-1">
            <button
              onClick={() => setActiveTab('protocols')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'protocols'
                  ? 'bg-lw-gold text-black'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Protocols
            </button>
            <button
              onClick={() => setActiveTab('stack')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'stack'
                  ? 'bg-lw-gold text-black'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Tech Stack
            </button>
          </div>
        </div>

        <div
          className={`transition-all duration-700 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {activeTab === 'protocols' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {protocols.map((proto) => (
                <div
                  key={proto.name}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-lw-gold/20 transition-all duration-300"
                >
                  <proto.icon className="h-6 w-6 text-lw-gold/60 group-hover:text-lw-gold mx-auto mb-3 transition-colors duration-300" />
                  <p className="text-sm font-semibold text-white/80">{proto.name}</p>
                  <p className="text-xs text-white/25 font-mono mt-1">{proto.label}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'stack' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {techStack.map((tech) => (
                <div
                  key={tech}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-lw-teal/20 transition-all duration-300"
                >
                  <div className="w-8 h-8 rounded-lg bg-lw-teal/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-xs font-bold text-lw-teal font-mono">
                      {tech.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white/80">{tech}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <p
          className={`mt-14 font-accent text-3xl sm:text-4xl text-lw-gold/80 transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Interoperability or death.
        </p>

        <Button
          size="lg"
          className={`mt-8 rounded-full bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:border-lw-gold/20 hover:text-white transition-all duration-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: isVisible ? '700ms' : '0ms' }}
          asChild
        >
          <a
            href="https://github.com/lawalletio/lawallet-nwc"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="mr-2 h-4 w-4" /> View on GitHub
            <ExternalLink className="ml-2 h-3 w-3 opacity-50" />
          </a>
        </Button>
      </div>
    </section>
  )
}

// ─── Roadmap ────────────────────────────────────────────────────────────────

const roadmapItems = [
  {
    title: 'Infrastructure & Security',
    description: 'Testing, auth, RBAC, rate limiting, error handling, logging',
    status: 'completed' as const,
    icon: Shield
  },
  {
    title: 'SDK & React Hooks',
    description: 'TypeScript client SDK, React hooks, CI/CD pipeline',
    status: 'in_progress' as const,
    icon: Code2
  },
  {
    title: 'Admin Dashboard',
    description: 'User management, activity monitor, Nostr login (NIP-07/46)',
    status: 'planned' as const,
    icon: PanelTopDashed
  },
  {
    title: 'User Dashboard & NWC Proxy',
    description: 'Profile, address config, courtesy NWC wallet provisioning',
    status: 'planned' as const,
    icon: Wallet
  },
  {
    title: 'Payment Listener & Zaps',
    description: 'NWC relay monitoring, webhooks (LUD-22), NIP-57 zaps',
    status: 'planned' as const,
    icon: Zap
  },
  {
    title: 'Deploy Everywhere',
    description: 'Vercel, Docker, Umbrel, Start9 — full documentation',
    status: 'planned' as const,
    icon: Globe
  },
  {
    title: 'Nostr CRM & Communications',
    description: 'DMs, broadcasts, segmentation, Nostr-native messaging',
    status: 'planned' as const,
    icon: MessageSquare
  },
  {
    title: 'Plugins: Events, Badges, Commerce',
    description: 'Community event management, NIP-58 badges, merchant directory',
    status: 'planned' as const,
    icon: Users
  }
]

const RoadmapSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="roadmap" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-coral mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Roadmap'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            What&apos;s <span className="text-gradient-gold">next</span>
          </h2>
          <p
            className={`mt-4 text-white/30 max-w-xl mx-auto transition-all duration-1000 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Funded by OpenSats. Built in public. Shipping monthly.
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-lw-teal/50 via-lw-gold/30 to-transparent" />

          <div className="space-y-6">
            {roadmapItems.map((item, index) => (
              <div
                key={item.title}
                className={`relative pl-16 transition-all duration-700 ${
                  isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
                }`}
                style={{
                  transitionDelay: isVisible ? `${index * 100 + 300}ms` : '0ms'
                }}
              >
                <div
                  className={`absolute left-4 top-4 w-4 h-4 rounded-full border-2 ${
                    item.status === 'completed'
                      ? 'bg-lw-teal border-lw-teal shadow-lg shadow-lw-teal/30'
                      : item.status === 'in_progress'
                        ? 'bg-lw-dark border-lw-gold animate-pulse-glow'
                        : 'bg-lw-dark border-white/15'
                  }`}
                />

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-all duration-300 group">
                  <div className="flex items-center gap-3 mb-1">
                    <item.icon className="h-4 w-4 text-white/30 group-hover:text-lw-gold transition-colors duration-300" />
                    <h3 className="text-base font-semibold text-white">{item.title}</h3>
                    <span
                      className={`ml-auto text-xs font-mono px-2.5 py-0.5 rounded-full ${
                        item.status === 'completed'
                          ? 'bg-lw-teal/10 text-lw-teal'
                          : item.status === 'in_progress'
                            ? 'bg-lw-gold/10 text-lw-gold'
                            : 'bg-white/5 text-white/25'
                      }`}
                    >
                      {item.status === 'completed'
                        ? 'shipped'
                        : item.status === 'in_progress'
                          ? 'building'
                          : 'planned'}
                    </span>
                  </div>
                  <p className="text-sm text-white/30 ml-7">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Waitlist / CTA ─────────────────────────────────────────────────────────

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
      const response = await fetch('/api/waitlist/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (data.success) {
        setIsSuccess(true)
        setEmail('')
      } else {
        setError(data.error || 'Subscription failed. Please try again.')
      }
    } catch {
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
      <section id="waitlist-section" className="py-20 sm:py-28">
        <div ref={ref} className="max-w-md mx-auto px-4 text-center">
          <div
            className={`rounded-2xl border border-lw-teal/20 bg-lw-teal/5 p-8 backdrop-blur-sm transition-all duration-1000 ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            <div className="w-14 h-14 bg-lw-teal rounded-full flex items-center justify-center mx-auto mb-5">
              <Check className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">You&apos;re in!</h2>
            <p className="text-white/40 mb-6 text-sm">
              We&apos;ll notify you when LaWallet NWC is ready for your community.
            </p>
            <Button
              onClick={resetForm}
              variant="outline"
              size="sm"
              className="border-white/10 text-white/50 hover:bg-white/5 hover:text-white bg-transparent"
            >
              Add another email
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id="waitlist-section" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-2xl mx-auto px-4 text-center">
        <Zap
          className={`h-8 w-8 text-lw-gold/40 mx-auto mb-6 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        />
        <h2
          className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Give your community
          <br />
          <span className="text-gradient-gold">Lightning addresses</span>
        </h2>
        <p
          className={`mt-4 text-white/30 max-w-md mx-auto transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Get early access. Be the first to deploy Lightning + Nostr for your community or company.
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
              placeholder="you@yourdomain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              className={`h-14 pl-5 pr-32 rounded-full bg-white/[0.04] border-white/[0.08] focus:ring-2 focus:ring-lw-gold/30 focus:border-lw-gold/30 text-white placeholder:text-white/20 font-mono text-sm transition-all duration-300 ${
                error ? 'border-lw-coral/40 focus:ring-lw-coral/30' : ''
              } ${isSubmitting ? 'opacity-50' : ''}`}
              aria-label="Email for waitlist"
            />
            <Button
              type="submit"
              disabled={isSubmitting || !email}
              className="absolute top-1.5 right-1.5 h-11 rounded-full px-6 bg-lw-gold hover:bg-lw-gold/90 text-black font-semibold transition-all duration-300 shadow-md shadow-lw-gold/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-black border-t-transparent" />
                  <span>Joining</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  Join <ArrowRight className="h-3.5 w-3.5" />
                </div>
              )}
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-lw-coral text-xs font-mono animate-fade-in">{error}</p>
          )}
        </form>
      </div>
    </section>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

const Footer = () => (
  <footer className="py-10 border-t border-white/[0.04]">
    <div className="max-w-6xl mx-auto px-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <img src="/logos/lawallet.svg" alt="LaWallet" className="h-5 w-auto opacity-40" />
        </div>

        <div className="flex items-center gap-6 text-xs text-white/20 font-mono">
          <a
            href="https://github.com/lawalletio/lawallet-nwc"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            GitHub
          </a>
          <a
            href="https://nwc.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            NWC
          </a>
          <a
            href="https://lawallet.ar"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            LaWallet
          </a>
          <a
            href="https://opensats.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            OpenSats
          </a>
        </div>

        <p className="text-xs text-white/15 font-mono">
          &copy; {new Date().getFullYear()} LaWallet — Open source, forever.
        </p>
      </div>
    </div>
  </footer>
)

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="relative min-h-screen w-full noise-overlay">
      <AnimatedBackground />
      <div className="relative z-10 flex flex-col">
        <Header />
        <main>
          <HeroSection />
          <TechStrip />
          <FeaturesSection />
          <DeploySection />
          <FlowSection />
          <OpenSourceSection />
          <RoadmapSection />
          <WaitlistSection />
        </main>
        <Footer />
      </div>
    </div>
  )
}
