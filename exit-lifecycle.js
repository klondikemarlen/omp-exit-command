export class ExitLifecycle {
  static finish(ctx) {
    ExitLifecycle.#printResumeCommand(ctx)
    void ctx.shutdown()
    ExitLifecycle.#scheduleProcessExit()
  }

  static getSessionKey(ctx) {
    return ExitLifecycle.#getSessionId(ctx) ?? ctx?.sessionManager ?? ctx
  }

  static #printResumeCommand(ctx) {
    const sessionId = ExitLifecycle.#getSessionId(ctx)
    const message = sessionId
      ? `Resume this session with omp --resume ${sessionId}`
      : "Resume this session with omp --resume <session-id>"

    process.stdout.write(`\n${message}\n`)
  }

  static #getSessionId(ctx) {
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

    return ExitLifecycle.#getSessionIdFromSessionFile(sessionManager)
  }

  static #getSessionIdFromSessionFile(sessionManager) {
    const sessionFile = ExitLifecycle.#getSessionFile(sessionManager)

    if (!sessionFile) {
      return undefined
    }

    const match = sessionFile.match(/_([^/]+)\.jsonl$/)

    return match?.[1]
  }

  static #getSessionFile(sessionManager) {
    if (typeof sessionManager?.getSessionFile === "function") {
      return sessionManager.getSessionFile()
    }

    if (typeof sessionManager?.sessionFile === "string") {
      return sessionManager.sessionFile
    }

    return undefined
  }

  static #scheduleProcessExit() {
    const timer = setTimeout(() => {
      process.exit(0)
    }, 0)

    timer.unref?.()
  }
}
