import { ExitLifecycle } from "./exit-lifecycle.js"

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
      ExitLifecycle.finish(ctx)

      return { handled: true }
    }

    if (prompt) {
      exitAfterResponseSessions.add(ExitLifecycle.getSessionKey(ctx))

      return { text: prompt }
    }

    return
  })

  pi.on("session_stop", async (_event, ctx) => {
    const sessionKey = ExitLifecycle.getSessionKey(ctx)

    if (!exitAfterResponseSessions.has(sessionKey)) {
      return
    }

    exitAfterResponseSessions.delete(sessionKey)
    ExitLifecycle.finish(ctx)
  })
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
