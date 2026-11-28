import { realpathSync, statSync, writeSync } from "node:fs"
import { isAbsolute } from "node:path"

const TAKE_OVER_DEFERRED_EXIT = "omp-exit-command:take-over-deferred-exit"
const FRESH_LAUNCH = "omp-instance-control:fresh-launch:"
const CHECKOUT_PENDING = "A checkout switch is already in progress. Do not replace it with another exit request."
// Allow ordinary spaces, but not hidden text, bidi overrides, or invalid filename encodings.
const UNSAFE_DISPLAY = /(?! )[\p{Cc}\p{Cf}\p{Cs}\p{Z}\p{Default_Ignorable_Code_Point}\uFFFD]/u
// Suggestions may contain line feeds and tabs, but no other control characters.
const TERMINAL_CONTROLS = /(?![\n\t])\p{Cc}/u
const EXIT_REFUSED = "OMP is staying open. Do not retry with exit_after_response in this turn."

export default function aiExitExtension(pi) {
  pi.setLabel("AI Exit Detection")

  const exitDecisions = new Map()
  const shutdownSuggestions = new Map()
  let pendingCheckout

  function refuseExit(sessionId, reason) {
    exitDecisions.set(sessionId, {
      kind: "refused",
    })
    return toolResult(`${reason} ${EXIT_REFUSED}`)
  }

  function sendFreshLaunch(operation, envelope) {
    try {
      // The launcher synchronously mutates this same envelope, not the return value of emit.
      pi.events.emit(FRESH_LAUNCH + operation, envelope)
      return true
    } catch {
      return false
    }
  }

  function cancelTicket(request) {
    const { sessionId, ticket } = request
    if (!ticket) return

    request.ticket = undefined
    sendFreshLaunch("cancel", {
      sessionId,
      ticket,
    })
  }

  function reportCheckoutRefusal(sessionId, ctx, reason) {
    const result = refuseExit(sessionId, reason)
    if (isMainTerminal(ctx) && ctx.hasUI) {
      ctx.ui?.notify?.(`Checkout switch refused: ${reason} OMP is staying open.`, "warning")
    }
    return result
  }

  function detachCheckout(request) {
    pendingCheckout = undefined
    request.signal?.removeEventListener("abort", request.onAbort)
  }

  function abandonCheckout(request, reason) {
    detachCheckout(request)
    cancelTicket(request)
    request.dialog.abort()
    return reportCheckoutRefusal(request.sessionId, request.ctx, reason)
  }

  async function prepareCheckout(sessionId, ctx, directory, signal) {
    if (!isMainTerminal(ctx) || !ctx.hasUI || typeof ctx.ui?.confirm !== "function") {
      return reportCheckoutRefusal(sessionId, ctx, "An approved checkout switch requires the main interactive terminal.")
    }
    if (typeof directory !== "string" || !isAbsolute(directory)) {
      return reportCheckoutRefusal(sessionId, ctx, "The absolute checkout directory is not resolved.")
    }
    if (pi.events.hasListeners?.(FRESH_LAUNCH + "prepare") === false) {
      return reportCheckoutRefusal(sessionId, ctx, "This session has no cooperating checkout launcher.")
    }

    const destination = readCheckoutDirectory(directory)
    if (!destination) {
      return reportCheckoutRefusal(sessionId, ctx, "The checkout directory is missing, is not a directory, or cannot be safely displayed.")
    }
    if (signal?.aborted) {
      return reportCheckoutRefusal(sessionId, ctx, "Checkout approval was interrupted.")
    }

    const request = {
      sessionId,
      ctx,
      signal,
      dialog: new AbortController(),
      onAbort: () => abandonCheckout(request, "The checkout switch was interrupted."),
      ticket: undefined,
    }
    pendingCheckout = request
    exitDecisions.set(sessionId, {
      kind: "checkout",
    })
    signal?.addEventListener("abort", request.onAbort, {
      once: true,
    })

    let confirmed
    try {
      confirmed = await ctx.ui.confirm("Open a fresh ompi session?", destination.directory, {
        initialIndex: 1,
        signal: request.dialog.signal,
      })
    } catch {
      // A failed dialog cannot grant approval.
    }

    if (pendingCheckout !== request) {
      return toolResult(`The checkout switch was abandoned. ${EXIT_REFUSED}`)
    }
    if (ctx.sessionManager.getSessionId() !== sessionId || signal?.aborted) {
      return abandonCheckout(request, "The checkout switch was interrupted.")
    }
    if (confirmed !== true) {
      return abandonCheckout(request, "The checkout switch was not approved.")
    }
    const current = readCheckoutDirectory(destination.directory)
    if (
      !current ||
      current.directory !== destination.directory ||
      current.dev !== destination.dev ||
      current.ino !== destination.ino
    ) {
      return abandonCheckout(request, "The checkout directory changed while awaiting approval.")
    }

    const envelope = {
      sessionId,
      directory: destination.directory,
    }
    const sent = sendFreshLaunch("prepare", envelope)
    const { result } = envelope
    if (result?.status === "accepted" && typeof result.ticket === "string" && result.ticket !== "") {
      request.ticket = result.ticket
    }
    if (pendingCheckout !== request) {
      cancelTicket(request)
      return toolResult(`The checkout switch was abandoned. ${EXIT_REFUSED}`)
    }
    if (ctx.sessionManager.getSessionId() !== sessionId) {
      return abandonCheckout(request, "The active session changed before checkout preparation completed.")
    }
    if (!sent) {
      return abandonCheckout(request, "The checkout launcher failed to prepare the switch.")
    }
    if (result === undefined) {
      return abandonCheckout(request, "This session has no cooperating checkout launcher.")
    }
    if (!request.ticket) {
      return abandonCheckout(request, launcherRefusal(result, "The checkout launcher did not prepare the switch."))
    }

    return toolResult("The checkout switch was approved and prepared. Finish the response; the launcher will be asked to open the fresh session afterward.")
  }

  function commitCheckout(request, event) {
    const finalReply = event.last_assistant_message
    if (
      !request.ticket ||
      request.signal?.aborted ||
      event.signal?.aborted ||
      request.ctx.hasPendingMessages?.() ||
      finalReply?.stopReason !== "stop" ||
      !Array.isArray(finalReply.content) ||
      !finalReply.content.some(part => part.type === "text" && part.text.trim())
    ) {
      abandonCheckout(request, "The response did not finish with an approved checkout switch.")
      return
    }

    detachCheckout(request)
    const envelope = {
      sessionId: request.sessionId,
      ticket: request.ticket,
    }
    if (sendFreshLaunch("commit", envelope) && envelope.result?.status === "committed") {
      return
    }

    cancelTicket(request)
    const reason = launcherRefusal(envelope.result, "The checkout launcher did not commit the switch.")
    reportCheckoutRefusal(request.sessionId, request.ctx, reason)
  }

  pi.on("input", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    if (pendingCheckout && isMainTerminal(ctx)) {
      pi.events.emit(TAKE_OVER_DEFERRED_EXIT, {
        sessionId,
      })
      if (event.source === "extension") return

      abandonCheckout(pendingCheckout, "New input cancelled the checkout switch.")
      return
    }
    if (event.source === "extension") return

    exitDecisions.delete(sessionId)
    shutdownSuggestions.delete(sessionId)
  })

  for (const event of ["session_switch", "session_branch", "session_clear", "session_tree", "session_before_shutdown"]) {
    pi.on(event, (_event, ctx) => {
      if (pendingCheckout && isMainTerminal(ctx)) {
        abandonCheckout(pendingCheckout, "A session change cancelled the checkout switch.")
      }
    })
  }

  pi.on("agent_end", (event, ctx) => {
    if (
      pendingCheckout?.sessionId === ctx.sessionManager.getSessionId() &&
      isMainTerminal(ctx) &&
      !event.willContinue &&
      !event.awaitingAsyncWork
    ) {
      abandonCheckout(pendingCheckout, "The turn ended before the checkout switch could be committed.")
    }
  })

  pi.registerTool({
    name: "exit_after_response",
    label: "Exit After Response",
    description: [
      "Use only when the user clearly wants OMP to exit and no action is requested after exit.",
      "Finish any requested wrap-up and required verification first.",
      "For a requested next action or blocked wrap-up, use exit_with_follow_up instead.",
      "Never use this tool to bypass a refusal or when the user is only asking about exit.",
    ].join(" "),
    parameters: pi.zod.object({
      reason: pi.zod.string().describe("Brief reason the user's message is an OMP exit request."),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId()
      const decision = exitDecisions.get(sessionId)
      if (decision?.kind === "refused") {
        return toolResult(EXIT_REFUSED)
      }
      if (decision?.kind === "checkout") {
        return toolResult(CHECKOUT_PENDING)
      }
      if (decision?.kind === "suggestion") {
        return toolResult("OMP will exit after this response and print the existing suggestion without running it.")
      }

      pi.events.emit(TAKE_OVER_DEFERRED_EXIT, {
        sessionId,
      })

      exitDecisions.set(sessionId, {
        kind: "plain",
      })
      return toolResult("OMP will exit after this response.")
    },
  })

  const { zod } = pi
  pi.registerTool({
    name: "exit_with_follow_up",
    label: "Exit With Follow-up",
    description: [
      "Use when the user explicitly directs OMP to exit and requests a post-exit action, or requested wrap-up before exit is blocked.",
      "Complete any requested wrap-up and required verification before selecting suggestion or checkout_switch.",
      "Use checkout_switch for a clear request to launch ompi in a particular checkout, even if the directory is missing.",
      "Use suggestion if what comes next is unclear or would require arbitrary shell commands.",
      "Pass only a meaningful, concise best guess as plain text, without Markdown fences. Omit it if there is no useful guess.",
      "Never execute, queue or prefill a proposed command. Never use suggestion as a fallback for a failed checkout switch.",
      "Use wrap_up_blocked if required work did not succeed. Do not call this just to answer a question about exit.",
    ].join(" "),
    parameters: zod.object({
      kind: zod.enum(["suggestion", "checkout_switch", "wrap_up_blocked"]),
      suggestion: zod.string().optional().describe("Copyable text for suggestion; omit if there is no useful guess."),
      directory: zod.string().optional().describe("Absolute directory for checkout_switch, if known."),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId()
      const decision = exitDecisions.get(sessionId)
      if (decision?.kind === "refused") {
        return toolResult(EXIT_REFUSED)
      }
      if (decision?.kind === "checkout" || (params.kind === "checkout_switch" && pendingCheckout)) {
        if (params.kind === "wrap_up_blocked" && pendingCheckout?.sessionId === sessionId) {
          return abandonCheckout(pendingCheckout, "The requested wrap-up has not succeeded.")
        }
        return toolResult(CHECKOUT_PENDING)
      }

      pi.events.emit(TAKE_OVER_DEFERRED_EXIT, {
        sessionId,
      })

      if (params.kind === "checkout_switch") {
        return prepareCheckout(sessionId, ctx, params.directory, signal)
      }

      if (params.kind === "wrap_up_blocked") {
        return refuseExit(sessionId, "The requested wrap-up has not succeeded.")
      }

      if (ctx.mode !== "tui" || ctx.agent.kind !== "main") {
        return refuseExit(sessionId, "Printing a post-exit suggestion requires the main terminal session.")
      }

      const suggestion = params.suggestion?.replace(/\r\n/g, "\n")
      const hasSafeSuggestion = suggestion?.trim() && !TERMINAL_CONTROLS.test(suggestion)
      let text = "No useful next action could be suggested."
      if (hasSafeSuggestion) {
        text = suggestion
      }

      exitDecisions.set(sessionId, {
        kind: "suggestion",
        text,
      })
      return toolResult("OMP will exit after this response and print a suggestion-only notice. Nothing was run or queued.")
    },
  })

  pi.on("session_stop", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    const decision = exitDecisions.get(sessionId)
    if (!decision || decision.kind === "refused") {
      return
    }
    if (decision.kind === "checkout") {
      if (
        pendingCheckout?.sessionId === sessionId &&
        event.session_id === sessionId &&
        isMainTerminal(ctx)
      ) {
        commitCheckout(pendingCheckout, event)
      }
      return
    }

    exitDecisions.delete(sessionId)
    if (decision.kind === "suggestion") {
      shutdownSuggestions.set(sessionId, decision.text)
    }

    pi.events.emit("omp-exit-command:exit-requested", {
      sessionId,
    })
    ctx.shutdown()
  })

  pi.on("session_shutdown", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    if (pendingCheckout?.sessionId === sessionId && isMainTerminal(ctx)) {
      abandonCheckout(pendingCheckout, "The terminal shut down before committing the checkout switch.")
    }
    const suggestion = shutdownSuggestions.get(sessionId)
    exitDecisions.delete(sessionId)
    shutdownSuggestions.delete(sessionId)
    if (!suggestion) {
      return
    }

    // The shutdown hook runs before the TUI relinquishes the terminal. Write
    // once at normal process exit so no later redraw erases the suggestion.
    process.once("exit", (code) => {
      if (code === 0) {
        writeSync(process.stdout.fd, `\nSuggestion only — not run\n${suggestion}\n`)
      }
    })
  })
}

function isMainTerminal(ctx) {
  return ctx.mode === "tui" && ctx.agent?.kind === "main"
}

function readCheckoutDirectory(directory) {
  if (UNSAFE_DISPLAY.test(directory)) return

  try {
    const canonicalDirectory = realpathSync(directory)
    if (UNSAFE_DISPLAY.test(canonicalDirectory)) return

    const info = statSync(canonicalDirectory, {
      bigint: true,
    })
    if (!info.isDirectory()) return

    return {
      directory: canonicalDirectory,
      dev: info.dev,
      ino: info.ino,
    }
  } catch {
    // Filesystem errors may include unsafe path bytes. Never display them directly.
  }
}

function launcherRefusal(result, fallback) {
  if (
    result?.status === "refused" &&
    typeof result.message === "string" &&
    result.message.trim() &&
    !UNSAFE_DISPLAY.test(result.message)
  ) {
    return result.message
  }
  return fallback
}

function toolResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  }
}
