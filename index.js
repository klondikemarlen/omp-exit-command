export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  let exitRequested = false

  pi.on("input", async (event, ctx) => {
    const input = getInputText(event)

    if (input === "exit") {
      exitRequested = true
      ctx.abort()
      ctx.ui.notify("Exiting omp.", "info")
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

function scheduleProcessExit() {
  const timer = setTimeout(() => {
    process.exit(0)
  }, 0)

  timer.unref?.()
}
