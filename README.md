# NorthStar 北极星

**AI-powered goal planning and daily productivity companion.**

Tell NorthStar where you want to go. It'll have a real conversation with you to
understand your goal, build you a personalized roadmap with reasoning behind
every decision, and generate focused daily tasks that actually fit your life.

Built with **Electron + React + TypeScript + Vite**, powered by **Claude**.

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Conversational Goal Coaching** | Natural multi-turn dialogue (not a form) to clarify your goal |
| 2 | **AI Roadmap + Reasoning** | Milestones with explained reasoning for every major decision |
| 3 | **Daily Task Generation** | Time-budget-aware daily plans with "why today" for each task |
| 4 | **Smart Recovery** | No-guilt missed-task handling with plan adjustment |
| 5 | **Mood Tracking** *(opt-in)* | Quick daily mood logging — off by default |
| 6 | **Calendar Heatmap** | GitHub-style activity visualization with streak tracking |
| 7 | **Milestone Celebrations** | Screenshot-worthy moments when milestones are reached |
| 8 | **Week 1 Pace Check** | AI proactively asks "does this pace feel right?" |

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| State | Zustand |
| Desktop | Electron 33 |
| AI | Claude claude-sonnet-4-5 via `@anthropic-ai/sdk` |
| Packaging | electron-builder (macOS, Windows, Linux) |
| CI/CD | GitHub Actions → GitHub Releases |

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (Vite dev server + Electron)
npm run dev            # renderer only (opens in browser)

# Build for production
npm run build
```

## Build Installers

```bash
npm run electron:build:mac     # → release/*.dmg
npm run electron:build:win     # → release/*.exe
npm run electron:build:linux   # → release/*.AppImage
```

## Automated Releases (GitHub Actions)

```bash
git tag v0.1.0
git push origin main --tags
```

Three parallel CI jobs build for macOS, Windows, and Linux, then publish a
GitHub Release with all installers attached.

## Project Structure

```
├── electron/
│   ├── main.ts          # Electron main process + IPC handlers
│   ├── ai-handler.ts    # Claude API calls (all 5 prompt types)
│   └── preload.ts       # Context-bridge for renderer
├── src/
│   ├── App.tsx          # Root shell (sidebar + page routing)
│   ├── types/index.ts   # Shared TypeScript types
│   ├── store/useStore.ts # Zustand state management
│   ├── services/ai.ts   # Renderer → main process AI bridge
│   ├── styles/global.css # Design system
│   ├── pages/
│   │   ├── WelcomePage.tsx      # First-launch welcome
│   │   ├── OnboardingPage.tsx   # Conversational goal setup
│   │   ├── DashboardPage.tsx    # Daily tasks + progress
│   │   ├── RoadmapPage.tsx      # Milestone timeline view
│   │   └── SettingsPage.tsx     # API key + opt-in features
│   └── components/
│       ├── Sidebar.tsx            # Navigation sidebar
│       ├── Heatmap.tsx            # GitHub-style calendar heatmap
│       ├── MoodLogger.tsx         # Mood tracking (opt-in)
│       ├── RecoveryModal.tsx      # Missed-task recovery flow
│       └── MilestoneCelebration.tsx # Celebration overlay
├── prompts/             # AI prompt designs (documentation)
├── index.html           # Vite HTML shell
├── vite.config.ts       # Vite + electron plugin config
└── .github/workflows/
    └── release.yml      # CI: build & publish releases
```

## Setup

1. Clone the repo and `npm install`
2. Launch with `npm run dev`
3. On first launch, enter your Claude API key
4. Tell NorthStar your goal — it'll guide you from there

## License

MIT