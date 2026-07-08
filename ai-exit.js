export default function aiExitExtension(pi) {
  pi.setLabel("AI Exit Detection")

  const exitAfterResponseSessions = new Set()

  pi.registerTool({
    name: "exit_after_response",
    label: "Exit After Response",
    description:
      "Call only when the user clearly wants OMP to exit after this response. Do not call for instructions about exiting other programs, such as vim, shells, games, or web pages.",
    parameters: pi.zod.object({
      reason: pi.zod.string().describe("Brief reason the user's message is an OMP exit request."),
    }),
    async execute(...args) {
      exitAfterResponseSessions.add(getSessionKey(args.find(isSessionContext)))
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

  pi.on("session_stop", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx)
    const fallbackKey = getSessionKey()

    if (exitAfterResponseSessions.has(sessionKey)) {
      exitAfterResponseSessions.delete(sessionKey)
    } else if (exitAfterResponseSessions.has(fallbackKey)) {
      exitAfterResponseSessions.delete(fallbackKey)
    } else {
      return
    }

    printResumeCommand(ctx)
    void ctx.shutdown()
    scheduleProcessExit()
  })
}

function isSessionContext(value) {
  return Boolean(value?.sessionManager || value?.sessionId)
}

function getSessionKey(ctx) {
  return getSessionId(ctx) ?? ctx?.sessionManager ?? ctx ?? "__next_session_stop__"
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
