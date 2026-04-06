/* ──────────────────────────────────────────────────────────
   NorthStar — English translations
   ────────────────────────────────────────────────────────── */

const en = {
  // ── Common ──
  common: {
    cancel: "Cancel",
    save: "Save",
    saved: "Saved!",
    confirm: "Confirm",
    delete: "Delete",
    close: "Close",
    back: "Back",
    next: "Next",
    continue: "Continue",
    loading: "Loading...",
    error: "Error",
    home: "Home",
    due: "Due",
    habit: "Habit",
    tasks: "Tasks",
    goals: "Goals",
    planning: "Planning",
    active: "Active",
    log: "Log",
  },

  // ── Sidebar ──
  sidebar: {
    today: "Today",
    tasks: "Tasks",
    calendar: "Calendar",
    roadmap: "Roadmap",
    goalCoach: "Goal Coach",
    wellbeing: "Wellbeing",
    settings: "Settings",
    goalsSection: "Goals",
  },

  // ── Welcome page ──
  welcome: {
    title: "NorthStar",
    subtitle: "北极星",
    description: "Tell me where you want to go.\nI'll help you build the map to get there.",
    feature1: "Tell me your goal — I'll ask the right questions",
    feature2: "Get a personalized roadmap with daily actions",
    feature3: "Track progress, adjust when life happens",
    getStarted: "Get Started",
    skipToDashboard: "Skip to Dashboard →",
    note: "Your data stays on this device. No account needed.",
  },

  // ── Onboarding ──
  onboarding: {
    title: "Let's figure out your goal",
    apiKeyStep: "First, I need your Claude API key to get started.",
    goalStep: "Tell me what you want to achieve. I'll ask the right questions.",
    generatingStep: "Building your personalized goal plan...",
    chatStep: "Let's keep talking until we've got it nailed down.",
    apiKeyTitle: "Claude API Key",
    apiKeyDesc: "NorthStar uses Claude to coach you through goal planning. Your key is stored locally on this device.",
    apiKeyPlaceholder: "sk-ant-api03-...",
    apiKeyHint: "Get your key at",
    goalPlaceholder: 'e.g. "I want to become a product manager"',
    chatPlaceholder: "Type your reply...",
    generatingAnalyzing: "Analyzing your goal and building your plan...",
    generatingTime: "This takes about 15-30 seconds",
    confirmButton: "Yes, build my goal plan!",
    confirmHint: "Or keep chatting to refine your goal",
    // New onboarding steps
    intentTitle: "What brings you here?",
    intentDesc: "Tell me what you'd like to accomplish with NorthStar. This helps me understand how to help you best.",
    intentPlaceholder: 'e.g. "I want to learn Japanese" or "Get better at time management"',
    skipForNow: "Skip for now",
    availabilityTitle: "When are you free?",
    availabilityDesc: "Mark the times you're typically available each week. This helps NorthStar plan tasks at the right times.",
    looksGood: "Looks good",
    doneTitle: "You're all set!",
    doneDesc: "Head to your dashboard to start adding goals and planning your week.",
    yourGoal: "Your goal",
    timeBlocks: "Availability",
    goToDashboard: "Go to Dashboard",
  },

  // ── Dashboard ──
  dashboard: {
    headerTitle: "Home",
    goalsCount: (count: number, pending: number) =>
      `${count} goal${count !== 1 ? "s" : ""} · ${pending} tasks pending`,
    noGoals: "Set a goal to get started",
    addGoal: "Add a new goal...",
    goalLabel: "What do you want to accomplish?",
    goalPlaceholder: '"Learn machine learning" or "Wash my shoes"',
    descriptionLabel: "Extra details",
    descriptionHint: "(optional — anything the AI should know)",
    descriptionPlaceholder: '"I already know Python basics", "Only free on weekends", "I want to focus on cardio not weights"',
    timelineLabel: "Timeline",
    targetDate: "Target date",
    habitLabel: "Habit",
    habitHint: "Ongoing — no due date. AI will plan for sustainable routines.",
    importanceLabel: "Importance",
    importanceLow: "low",
    importanceMedium: "medium",
    importanceHigh: "high",
    importanceCritical: "critical",
    analyzing: "Analyzing...",
    addGoalBtn: "Add Goal",
    generateDaily: "Generate Daily",
    noTasks: "No tasks yet. Add a goal above to get started!",
    activity: "Activity",
    dayStreak: (streak: number, total: number) =>
      `${streak} day streak · ${total} total active days`,
    overall: "Overall",
    milestone: "Milestone",
    today: "Today",
    adjustPlan: "Adjust my plan",
    recoveryPrompt: "Some tasks are still open. Need help adjusting?",
    priority: "Priority",
    quickWin: "Quick win",
    snoozed: "Snoozed",
    skipped: "Skipped",
    stop: "Stop",
    timer: "Timer",
    snooze: "Snooze",
    skip: "Skip",
    cognitiveWeight: "Cognitive load",
    weightPts: "pts",
    goalTasks: "From your goal plans",
  },

  // ── Home (chat-centric dashboard) ──
  home: {
    chatTitle: "Chat",
    chatPlaceholder: "Ask a question, add a task, or just chat...",
    chatEmpty: "Ask me anything about your goals, or type a quick task to add to your day.",
    chatError: "Sorry, something went wrong. Please try again.",
    thinking: "Thinking...",
    taskDetected: "Got it! I'm analyzing this task for you. Check the pending section above once it's ready.",
    pendingTitle: "Pending Tasks",
    pendingSubtitle: "Review and confirm these tasks to add them to your schedule.",
    analyzing: "Analyzing...",
    confirmTask: "Add to Tasks",
    rejectTask: "Dismiss",
    conflicts: "Possible conflicts",
  },

  // ── Goal Plan Page ──
  goalPlan: {
    notFound: "Goal not found.",
    backToHome: "Back to Home",
    reviewPlan: "Review the plan above. You can chat with AI to make changes, or confirm to start.",
    discussChanges: "Discuss Changes",
    confirmStart: "Confirm & Start",
    planningChat: "Planning Chat",
    thinking: "Thinking...",
    chatPlaceholder: "Suggest changes, ask questions, or say 'confirm' to finalize...",
    creatingPlan: "Creating your plan...",
    creatingPlanDesc: "AI is analyzing your goal and building a structured roadmap.",
    tasksProgress: (completed: number, total: number, percent: number) =>
      `${completed}/${total} tasks · ${percent}%`,
    milestoneTimeline: "Milestone Timeline",
    milestoneProgress: (completed: number, total: number, percent: number) =>
      `${completed}/${total} tasks · ${percent}%`,
    unlockNextWeek: "Unlock Next Week",
    lockedHint: "Complete current tasks to unlock",
    editObjective: "Edit objective",
    editTask: "Edit task",
    editApproved: "Looks good",
    editCaution: "Caution",
    editWarning: "Warning",
    suggestedChanges: "Suggested adjustments:",
    requiresReplan: "This change is significant — it may need a full plan revision. Use the chat to discuss with AI.",
    applyEdit: "Apply",
    discussInChat: "Discuss in Chat",
  },

  // ── Settings ──
  settings: {
    title: "Settings",
    noUser: "Set up your goal first.",
    getStarted: "Get started",
    apiKeyTitle: "Claude API Key",
    apiKeyDesc: "Your API key is stored locally on this device and never sent anywhere except directly to Anthropic's API.",
    optionalTitle: "Optional Features",
    optionalDesc: "These features are off by default. Enable them if you'd find them helpful.",
    moodTracking: "Mood Tracking",
    moodTrackingDesc: "Log how you're feeling each day. Data stays private.",
    newsFeed: "News Feed",
    newsFeedDesc: "Curated articles and resources related to your goal.",
    calendarTitle: "Calendar & Device Sync",
    calendarDesc: "NorthStar has its own calendar where you add events. You can optionally sync with your device's calendar apps. Go to the Calendar page to manage events and sync settings.",
    openCalendar: "Open Calendar Settings",
    memoryTitle: "AI Memory",
    memoryDesc: "NorthStar learns from your behavior — when you complete tasks, what you snooze, and how your schedule actually plays out. This makes the AI's plans more personalized over time.",
    noMemory: "No memory data yet. The AI will start learning as you use the app.",
    factsLearned: "Facts learned:",
    preferencesDetected: "Preferences detected:",
    behavioralSignals: "Behavioral signals:",
    reflectionCycles: "Reflection cycles:",
    whatAiKnows: "What the AI knows about you:",
    detectedPreferences: "Detected preferences:",
    runReflection: "Run Reflection Now",
    reflecting: "Reflecting…",
    clearMemory: "Clear Memory",
    clearMemoryConfirm: "Clear all AI memory? The AI will start learning from scratch.",
    memoryCleared: "Memory cleared.",
    reflectionNeedsKey: "Reflection requires an API key and some usage data.",
    reflectionFailed: "Reflection failed. Check your API key.",
    noPatterns: "No new patterns found yet. Keep using the app!",
    newInsights: (count: number) =>
      `✨ Learned ${count} new insight${count > 1 ? "s" : ""}!`,
    resetTitle: "Reset Everything",
    resetDesc: "Erase all data and start with a fresh goal. This cannot be undone.",
    resetBtn: "Reset All Data",
    resetConfirm: "This will erase all data and start fresh. Are you sure?",
    languageTitle: "Language",
    languageDesc: "Choose your preferred interface language.",
    languageLabel: "Interface Language",
  },

  // ── Mood Logger ──
  mood: {
    howFeeling: "How are you feeling?",
    rough: "Rough",
    low: "Low",
    okay: "Okay",
    good: "Good",
    great: "Great",
    notePlaceholder: "Quick note (optional)",
    feeling: (label: string) => `Feeling ${label} today`,
  },

  // ── Recovery Modal ──
  recovery: {
    title: "Let's adjust your plan",
    subtitle: (count: number) =>
      `You had ${count} task${count > 1 ? "s" : ""} left today. What got in the way?`,
    adjusting: "Adjusting your plan...",
    noTime: "Ran out of time",
    tooHard: "Felt stuck / didn't know how",
    lowEnergy: "Low energy / wasn't feeling it",
    forgot: "Just forgot",
    life: "Life happened",
    other: "Something else",
    adjustedPlan: "Adjusted plan",
    gotIt: "Got it, thanks",
  },

  // ── Milestone Celebration ──
  celebration: {
    title: "Milestone Complete!",
    days: "Days",
    tasksDone: "Tasks Done",
    upNext: (preview: string) => `Up next: ${preview}`,
    keepGoing: "Keep going! 🚀",
  },

  // ── Heatmap ──
  heatmap: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    days: ["", "Mon", "", "Wed", "", "Fri", ""],
    less: "Less",
    more: "More",
  },

  // ── Goal Types ──
  goalTypes: {
    bigGoals: "Big Goals",
    everydayTasks: "Everyday Tasks",
    repeatingEvents: "Repeating Events",
    big: "Long-term",
    everyday: "Quick task",
    repeating: "Recurring",
    vacationActive: "Vacation mode is active",
    startVacation: "Going on vacation?",
    endVacation: "End Vacation",
    progressSummary: "Progress",
    allComplete: "All done!",
    noEveryday: "No everyday tasks. Add one from the dashboard.",
    noRepeating: "No repeating events yet.",
  },

  // ── Multi-Agent System ──
  agents: {
    title: "AI Agents Working",
    coordinator: "Coordinator",
    research: "Research Agent",
    planner: "Planner Agent",
    task: "Task Agent",
    news: "News Agent",
    searching: "Searching the web...",
    analyzing: "Analyzing findings...",
    generating: "Generating plan...",
    researchComplete: "Research complete",
    planReady: "Plan ready",
    newsTitle: "Today's Briefing",
    newsEmpty: "No news yet. News will appear after your first daily task generation.",
    newsLoading: "Fetching today's relevant news...",
    newsError: "Could not load news. Will retry later.",
    viewSource: "View source",
    researchInsights: "Research Insights",
    peerInsights: "What others have done",
    typicalTimeline: "Typical timeline",
    commonMistakes: "Common mistakes to avoid",
    bestPractices: "Best practices",
  },
} as const;

// Recursive type that allows any string values in other locales
type DeepStringify<T> = {
  -readonly [K in keyof T]: T[K] extends readonly any[]
    ? readonly string[] | string[]
    : T[K] extends (...args: infer A) => any
      ? (...args: A) => string
      : T[K] extends object
        ? DeepStringify<T[K]>
        : string;
};

export type Translations = DeepStringify<typeof en>;
export default en;
