export function getSessionKey(ctx) {
  return getSessionId(ctx) ?? ctx?.sessionManager ?? ctx
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
