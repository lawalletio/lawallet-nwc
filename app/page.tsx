'use client'

import {
  AnimatedBackground,
  Header,
  HeroSection,
  TechStrip,
  FeaturesSection,
  DeploySection,
  FlowSection,
  OpenSourceSection,
  RoadmapSection,
  WaitlistSection,
  Footer,
} from '@/components/landing'

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
