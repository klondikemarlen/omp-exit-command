export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  let exitRequested = false

  pi.on("input", async (event, ctx) => {
    const input = getInputText(event)

    if (input === "exit") {
      exitRequested = true
      ctx.abort()
      printResumeCommand(ctx)
      void ctx.shutdown()
      scheduleProcessExit()

      return { action: "handled" }
    }

    return { action: "continue" }
  })

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!exitRequested) {
      return
    }

    ctx.abort()
    void ctx.shutdown()
    scheduleProcessExit()
  })
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

  process.stdout.write(`${message}\n`)
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
