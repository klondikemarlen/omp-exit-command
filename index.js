const EXIT_COMMAND_PATTERN = /^(?:please\s+)?exit(?:\s+after\s+this(?:\s+now)?)?[.!?]*$/i
const PROMPT_EXIT_PATTERNS = [
  /^(.+?)\s*(?:,|;)\s*(?:please\s+)?exit(?:\s+after\s+this(?:\s+now)?)?[.!?]*$/i,
  /^(.+?)[.!?]\s+(?:please\s+)?exit(?:\s+after\s+this(?:\s+now)?)?[.!?]*$/i,
  /^(.+?)\s*,?\s+(?:and\s+)?then\s+(?:please\s+)?exit[.!?]*$/i,
  /^(.+?)\s*,?\s+and\s+(?:please\s+)?exit[.!?]*$/i,
]

export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  pi.registerFlag?.("ai-exit-detection", {
    description:
      "Enable an opt-in model-callable tool that lets the assistant schedule OMP exit after its response.",
    type: "boolean",
    default: false,
  })

  let exitAfterResponse = false

  pi.on("input", async (event, ctx) => {
    const input = getInputText(event)
    const prompt = getPromptBeforeExitDirective(input)

    if (isExitCommand(input)) {
      ctx.abort()
      finishExit(ctx)

      return { handled: true }
    }

    if (prompt) {
      exitAfterResponse = true

      return { text: prompt }
    }

    return
  })

  pi.registerTool?.({
    name: "exit_after_response",
    label: "Exit After Response",
    description:
      "Opt-in exit-command helper. Call only when the user clearly wants OMP to exit after this response. Do not call for instructions about exiting other programs, such as vim, shells, games, or web pages.",
    parameters: pi.zod.object({
      reason: pi.zod.string().describe("Brief reason the user's message is an OMP exit request."),
    }),
    defaultInactive: true,
    async execute() {
      exitAfterResponse = true

      return {
        content: [
          {
            type: "text",
            text: "OMP will exit after this response.",
          },
        ],
      }
    },
  })

  pi.on("session_start", async () => {
    if (!pi.getFlag?.("ai-exit-detection")) {
      return
    }

    const activeTools = pi.getActiveTools?.()

    if (activeTools && !activeTools.includes("exit_after_response")) {
      await pi.setActiveTools?.([...activeTools, "exit_after_response"])
    }
  })

  pi.on("session_stop", async (_event, ctx) => {
    if (!exitAfterResponse) {
      return
    }

    exitAfterResponse = false
    finishExit(ctx)
  })
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
