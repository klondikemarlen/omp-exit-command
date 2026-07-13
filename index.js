const EXIT_DIRECTIVE = "(?:please\\s+)?(?:exit(?:\\s+after\\s+this(?:\\s+now)?)?|quit)"
const CONVERSATIONAL_EXIT_COMMANDS = [
  "farewell",
  "see\\s+you(?:\\s+(?:later|soon|around))?",
  "catch\\s+you\\s+later",
  "talk\\s+to\\s+you\\s+later",
  "take\\s+care",
  "until\\s+next\\s+time",
  "have\\s+a\\s+(?:good|great)\\s+(?:day|night)",
]
const CONVERSATIONAL_EXIT_DIRECTIVE =
  `(?:(?:thanks|thank\\s+you)(?:\\s*,\\s*|\\s+and\\s+|\\s+))?(?:${CONVERSATIONAL_EXIT_COMMANDS.join("|")})`
const EXIT_COMMAND_PATTERN = new RegExp(
  `^(?:${EXIT_DIRECTIVE}|${CONVERSATIONAL_EXIT_DIRECTIVE})[.!?]*$`,
  "i"
)
const PROMPT_EXIT_PATTERNS = [EXIT_DIRECTIVE, CONVERSATIONAL_EXIT_DIRECTIVE].flatMap(
  (directive) => [
    new RegExp(`^(.+?)\\s*(?:,|;)\\s*${directive}[.!?]*$`, "i"),
    new RegExp(`^(.+?)[.!?]\\s+${directive}[.!?]*$`, "i"),
    new RegExp(`^(.+?)\\s*,?\\s+(?:and\\s+)?then\\s+${directive}[.!?]*$`, "i"),
    new RegExp(`^(.+?)\\s*,?\\s+and\\s+${directive}[.!?]*$`, "i"),
  ]
)

export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  const exitAfterResponseSessions = new Set()

  pi.on("input", async (event, ctx) => {
    const input = getInputText(event)
    const prompt = getPromptBeforeExitDirective(input)

    if (isExitCommand(input)) {
      ctx.abort()
      finishExit(ctx)

      return { handled: true }
    }

    if (prompt) {
      exitAfterResponseSessions.add(getSessionKey(ctx))

      return { text: prompt }
    }

    return
  })

  pi.on("session_stop", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx)

    if (!exitAfterResponseSessions.has(sessionKey)) {
      return
    }

    exitAfterResponseSessions.delete(sessionKey)
    finishExit(ctx)
  })
}

function getSessionKey(ctx) {
  return getSessionId(ctx) ?? ctx?.sessionManager ?? ctx
}

function finishExit(ctx) {
  printResumeCommand(ctx)
  void ctx.shutdown()
  scheduleProcessExit()
}

function isExitCommand(input) {
  return EXIT_COMMAND_PATTERN.test(input)
}

function getPromptBeforeExitDirective(input) {
  for (const pattern of PROMPT_EXIT_PATTERNS) {
    const match = input.match(pattern)

    if (match?.[1]) {
      return match[1].trim().replace(/[;,\s]+$/, "")
    }
  }

  return undefined
}

function getInputText(event) {
  if (typeof event === "string") {
    return event.trim()
  }

  if (typeof event?.input === "string") {
    return event.input.trim()
  }

  if (typeof event?.text === "string") {
    return event.text.trim()
  }

  if (typeof event?.content === "string") {
    return event.content.trim()
  }

  if (typeof event?.message === "string") {
    return event.message.trim()
  }

  return ""
}

function printResumeCommand(ctx) {
  const sessionId = getSessionId(ctx)
  const message = sessionId
    ? `Resume this session with omp --resume ${sessionId}`
    : "Resume this session with omp --resume <session-id>"

  process.stdout.write(`\n${message}\n`)
}

function getSessionId(ctx) {
  const sessionManager = ctx?.sessionManager

  if (typeof sessionManager?.getSessionId === "function") {
    return sessionManager.getSessionId()
  }

  if (typeof sessionManager?.sessionId === "string") {
    return sessionManager.sessionId
  }

  if (typeof ctx?.sessionId === "string") {
    return ctx.sessionId
  }

  return getSessionIdFromSessionFile(sessionManager)
}

function getSessionIdFromSessionFile(sessionManager) {
  const sessionFile = getSessionFile(sessionManager)

  if (!sessionFile) {
    return undefined
  }

  const match = sessionFile.match(/_([^/]+)\.jsonl$/)

  return match?.[1]
}

function getSessionFile(sessionManager) {
  if (typeof sessionManager?.getSessionFile === "function") {
    return sessionManager.getSessionFile()
  }

  if (typeof sessionManager?.sessionFile === "string") {
    return sessionManager.sessionFile
  }

  return undefined
}

function scheduleProcessExit() {
  const timer = setTimeout(() => {
    process.exit(0)
  }, 0)

  timer.unref?.()
}
