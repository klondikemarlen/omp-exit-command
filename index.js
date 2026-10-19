const EXIT_DIRECTIVE = "(?:please\\s+)?(?:exit(?:\\s+after\\s+this(?:\\s+now)?)?|quit)"
const CONVERSATIONAL_EXIT_COMMANDS = [
  "farewell",
  "bye(?:\\s+for\\s+now)?",
  "see\\s+you(?:\\s+(?:later|soon|around))?",
  "catch\\s+you\\s+later",
  "talk\\s+to\\s+you\\s+later",
  "take\\s+care",
  "until\\s+next\\s+time",
  "have\\s+a\\s+(?:good|great)\\s+(?:day|night)",
]
const CONVERSATIONAL_EXIT_DIRECTIVE =
  `(?:(?:thanks|thank\\s+you|sounds\\s+good)(?:\\s*[,!?]\\s*|\\s+and\\s+|\\s+))?(?:${CONVERSATIONAL_EXIT_COMMANDS.join("|")})`
const EXIT_COMMAND_PATTERN = new RegExp(
  `^(?:${EXIT_DIRECTIVE}|${CONVERSATIONAL_EXIT_DIRECTIVE})[.!?]*$`,
  "i"
)
// Keep separator whitespace outside a prompt capture ending in a non-whitespace character.
// Overlapping whitespace captures can block the input hook on large pasted prompts.
const PROMPT_EXIT_PATTERNS = [EXIT_DIRECTIVE, CONVERSATIONAL_EXIT_DIRECTIVE].flatMap(
  (directive) => [
    new RegExp(`^(.*?\\S)\\s*[,;]\\s*${directive}[.!?]*$`, "is"),
    new RegExp(`^(.+?)[.!?]\\s+${directive}[.!?]*$`, "is"),
    new RegExp(`^(.*?\\S)\\s+(?:and\\s+)?then\\s+${directive}[.!?]*$`, "is"),
    new RegExp(`^(.*?\\S)\\s+and\\s+${directive}[.!?]*$`, "is"),
  ]
)
const TRAILING_PROMPT_SEPARATOR_PATTERN = /[;,\s]/

export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  const exitAfterResponseSessions = new Set()

  pi.on("input", (event, ctx) => {
    const input = event.text.trim()

    if (isExitCommand(input)) {
      ctx.abort()

      return { text: "/exit" }
    }

    const prompt = getPromptBeforeExitDirective(input)

    if (prompt) {
      exitAfterResponseSessions.add(ctx.sessionManager.getSessionId())

      return { text: prompt }
    }

    return
  })

  pi.on("session_stop", (_event, ctx) => {
    if (!exitAfterResponseSessions.delete(ctx.sessionManager.getSessionId())) {
      return
    }

    ctx.shutdown()
  })
}

function isExitCommand(input) {
  return EXIT_COMMAND_PATTERN.test(input)
}

function getPromptBeforeExitDirective(input) {
  for (const pattern of PROMPT_EXIT_PATTERNS) {
    const match = input.match(pattern)

    if (!match) continue

    const prompt = match[1]
    let end = prompt.length

    while (end > 0 && TRAILING_PROMPT_SEPARATOR_PATTERN.test(prompt[end - 1])) {
      end -= 1
    }

    return prompt.slice(0, end).trimStart()
  }

  return undefined
}
