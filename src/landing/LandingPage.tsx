import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  CirclePlay,
  Columns3,
  FolderKanban,
  Github,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Sparkles,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'

interface Feature {
  title: string
  description: string
  icon: LucideIcon
  className: string
}

const features: Feature[] = [
  {
    title: 'Workspace organization',
    description: 'Keep teams, projects, and day-to-day work together in focused workspaces.',
    icon: LayoutDashboard,
    className: 'landing-feature--workspace',
  },
  {
    title: 'Projects and tasks',
    description: 'Turn outcomes into owned tasks with priorities, progress, and the context to move forward.',
    icon: ListChecks,
    className: 'landing-feature--projects',
  },
  {
    title: 'Kanban workflow',
    description: 'See work across every stage and move tasks through a clear, flexible board.',
    icon: Columns3,
    className: 'landing-feature--kanban',
  },
  {
    title: 'Assignments and due dates',
    description: 'Make ownership visible and keep important dates close to the work they affect.',
    icon: CalendarClock,
    className: 'landing-feature--assignments',
  },
  {
    title: 'Team collaboration',
    description: 'Bring teammates into the right workspace and keep task discussion connected to delivery.',
    icon: UsersRound,
    className: 'landing-feature--team',
  },
  {
    title: 'Progress insights',
    description: 'Read project health, completed work, due dates, and overdue tasks at a glance.',
    icon: BarChart3,
    className: 'landing-feature--insights',
  },
]

export function LandingPage() {
  const { enterDemo } = useAuth()
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoError, setDemoError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!mobileOpen) return
    menuCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileOpen(false)
      window.requestAnimationFrame(() => menuTriggerRef.current?.focus())
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  const closeMobileNavigation = (restoreFocus = false) => {
    setMobileOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => menuTriggerRef.current?.focus())
  }

  const openDemo = async () => {
    if (demoLoading) return
    setDemoLoading(true)
    setDemoError('')
    try {
      await enterDemo()
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : 'ProjectFlow could not prepare the demo. Try again in a moment.')
    } finally {
      setDemoLoading(false)
    }
  }

  const demoButton = (className: string) => (
    <button className={className} type="button" onClick={() => void openDemo()} disabled={demoLoading}>
      {demoLoading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <CirclePlay size={18} aria-hidden="true" />}
      {demoLoading ? 'Preparing your demo…' : 'Try Live Demo'}
    </button>
  )

  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-main">Skip to main content</a>
      <header className="landing-header">
        <div className="landing-nav-shell">
          <Link className="landing-brand-link" to="/" aria-label="ProjectFlow home">
            <Brand />
          </Link>
          <nav className="landing-nav" aria-label="Primary">
            <a href="#product">Product</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
          </nav>
          <div className="landing-nav-actions">
            <Link className="landing-sign-in" to="/login">Sign in</Link>
            {demoButton('landing-button landing-button--primary landing-nav-demo')}
            <button
              ref={menuTriggerRef}
              className="landing-mobile-trigger"
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="landing-mobile-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="landing-mobile-overlay" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMobileNavigation(true)
          }}>
            <nav id="landing-mobile-navigation" className="landing-mobile-nav" aria-label="Mobile">
              <div className="landing-mobile-nav__header">
                <span>Navigate</span>
                <button ref={menuCloseRef} type="button" aria-label="Close navigation" onClick={() => closeMobileNavigation(true)}>
                  <X size={21} aria-hidden="true" />
                </button>
              </div>
              <a href="#product" onClick={() => closeMobileNavigation()}>Product</a>
              <a href="#features" onClick={() => closeMobileNavigation()}>Features</a>
              <a href="#how-it-works" onClick={() => closeMobileNavigation()}>How It Works</a>
              <Link to="/login" onClick={() => closeMobileNavigation()}>Sign in</Link>
              {demoButton('landing-button landing-button--primary')}
            </nav>
          </div>
        )}
      </header>

      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-glow landing-glow--hero" aria-hidden="true" />
          <div className="landing-container landing-hero__layout">
            <div className="landing-hero__copy">
              <p className="landing-eyebrow"><Sparkles size={15} aria-hidden="true" /> One workspace. A clearer way forward.</p>
              <h1 id="landing-title">Bring clarity to every project.</h1>
              <p className="landing-hero__lede">Plan projects, organize work, and collaborate with your team in a focused workspace built to keep progress visible.</p>
              <div className="landing-hero__actions">
                {demoButton('landing-button landing-button--primary landing-button--large')}
                <a className="landing-button landing-button--secondary landing-button--large" href="#features">
                  Explore Features <ArrowRight size={17} aria-hidden="true" />
                </a>
              </div>
              <p className="landing-hero__note"><LockKeyhole size={15} aria-hidden="true" /> No registration required. Your private demo is cleared after 30 minutes.</p>
              {demoError && <p className="landing-demo-error" role="alert">{demoError}</p>}
            </div>

            <div className="landing-hero-preview" aria-label="ProjectFlow application preview">
              <div className="landing-window-bar" aria-hidden="true">
                <span /><span /><span />
                <strong>Northstar Studio</strong>
              </div>
              <picture>
                <source media="(max-width: 800px)" srcSet="/projectflow-dashboard-800.jpg" />
                <img
                  src="/projectflow-dashboard-1280.jpg"
                  alt="ProjectFlow dashboard showing project health, task progress, and recent work"
                  width="1280"
                  height="800"
                  fetchPriority="high"
                  decoding="async"
                />
              </picture>
              <div className="landing-preview-float landing-preview-float--progress" aria-hidden="true">
                <span><Check size={14} /> Project health</span>
                <strong>On track</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-product" id="product" aria-labelledby="product-title">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--center">
              <p className="landing-kicker">The product</p>
              <h2 id="product-title">See ProjectFlow in action.</h2>
              <p>Move from a high-level read of project health to the tasks that need attention, without losing context.</p>
            </div>
            <div className="landing-product-grid">
              <article className="landing-product-card landing-product-card--dashboard">
                <div className="landing-product-card__copy">
                  <span><BarChart3 size={15} aria-hidden="true" /> Dashboard</span>
                  <h3>Know where work stands.</h3>
                  <p>Review active projects, completion, upcoming work, and overdue tasks from one calm overview.</p>
                </div>
                <picture>
                  <source media="(max-width: 800px)" srcSet="/projectflow-dashboard-800.jpg" />
                  <img
                    src="/projectflow-dashboard-1280.jpg"
                    alt="ProjectFlow dashboard overview for the Northstar Studio workspace"
                    width="1280"
                    height="800"
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              </article>
              <article className="landing-product-card landing-product-card--kanban">
                <div className="landing-product-card__copy">
                  <span><Columns3 size={15} aria-hidden="true" /> Kanban</span>
                  <h3>Keep work moving.</h3>
                  <p>Organize tasks across workflow stages, update details, and make the next step visible to everyone.</p>
                </div>
                <picture>
                  <source media="(max-width: 800px)" srcSet="/projectflow-kanban-800.jpg" />
                  <img
                    src="/projectflow-kanban-1280.jpg"
                    alt="ProjectFlow Kanban board with tasks organized across workflow columns"
                    width="1280"
                    height="800"
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-features" id="features" aria-labelledby="features-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <p className="landing-kicker">Built for focused delivery</p>
              <h2 id="features-title">Everything your team needs to move work forward.</h2>
              <p>ProjectFlow connects planning, ownership, delivery, and collaboration without adding noise around the work.</p>
            </div>
            <div className="landing-feature-grid">
              {features.map(({ title, description, icon: Icon, className }) => (
                <article className={`landing-feature-card ${className}`} key={title}>
                  <span className="landing-feature-card__icon"><Icon size={20} aria-hidden="true" /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="landing-feature-card__line" aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-how" id="how-it-works" aria-labelledby="how-title">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--center">
              <p className="landing-kicker">How it works</p>
              <h2 id="how-title">A clear path from idea to done.</h2>
              <p>Explore the complete workflow in a private demo workspace—no registration or setup required.</p>
            </div>
            <ol className="landing-steps">
              <li>
                <span className="landing-step-number">01</span>
                <span className="landing-step-icon"><FolderKanban size={21} aria-hidden="true" /></span>
                <h3>Enter your workspace.</h3>
                <p>Start a temporary, isolated workspace already populated with realistic project data.</p>
              </li>
              <li>
                <span className="landing-step-number">02</span>
                <span className="landing-step-icon"><ListChecks size={21} aria-hidden="true" /></span>
                <h3>Organize projects and tasks.</h3>
                <p>Edit tasks, set ownership and due dates, and move work through the Kanban board.</p>
              </li>
              <li>
                <span className="landing-step-number">03</span>
                <span className="landing-step-icon"><MessageSquareText size={21} aria-hidden="true" /></span>
                <h3>Track progress and collaborate.</h3>
                <p>Review project health, explore the team workspace, and keep discussion with the work.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="landing-demo-cta" aria-labelledby="demo-cta-title">
          <div className="landing-glow landing-glow--cta" aria-hidden="true" />
          <div className="landing-container landing-demo-cta__inner">
            <span className="landing-demo-cta__icon"><CirclePlay size={24} aria-hidden="true" /></span>
            <p className="landing-kicker">Fully interactive portfolio demo</p>
            <h2 id="demo-cta-title">Your private workspace is ready when you are.</h2>
            <p>Use the real ProjectFlow application for 30 minutes. Your changes stay isolated from other visitors and are removed automatically.</p>
            {demoButton('landing-button landing-button--primary landing-button--large')}
            <span className="landing-demo-cta__note"><LockKeyhole size={14} aria-hidden="true" /> Temporary data · Private session · No account needed</span>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner">
          <div className="landing-footer__brand">
            <Brand />
            <p>A full-stack project management application designed and built as a portfolio project.</p>
          </div>
          <nav className="landing-footer__links" aria-label="Footer">
            <a href="#product">Product</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create an account</Link>
            <a href="https://github.com/Yukiiii2/projectflow" target="_blank" rel="noreferrer">View source on GitHub <Github size={15} aria-hidden="true" /></a>
          </nav>
        </div>
        <div className="landing-container landing-footer__bottom">
          <span>© {new Date().getFullYear()} ProjectFlow</span>
          <span>React · Express · PostgreSQL</span>
        </div>
      </footer>
    </div>
  )
}
