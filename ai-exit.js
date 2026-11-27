import { writeSync } from "node:fs"
import { isAbsolute } from "node:path"

const TAKE_OVER_DEFERRED_EXIT = "omp-exit-command:take-over-deferred-exit"
const TERMINAL_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/
const EXIT_REFUSED = "OMP is staying open. Do not retry with exit_after_response in this turn."

export default function aiExitExtension(pi) {
  pi.setLabel("AI Exit Detection")

  const exitDecisions = new Map()
  const shutdownSuggestions = new Map()

  function refuseExit(sessionId, reason) {
    exitDecisions.set(sessionId, {
      kind: "refused",
    })
    return toolResult(`${reason} ${EXIT_REFUSED}`)
  }

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") {
      return
    }

    const sessionId = ctx.sessionManager.getSessionId()
    exitDecisions.delete(sessionId)
    shutdownSuggestions.delete(sessionId)
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
      directory: zod.string().optional().describe("Resolved absolute directory for checkout_switch, if known."),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId()
      if (exitDecisions.get(sessionId)?.kind === "refused") {
        return toolResult(EXIT_REFUSED)
      }

      pi.events.emit(TAKE_OVER_DEFERRED_EXIT, {
        sessionId,
      })

      // A clear switch is not ambiguous, even without a launcher or directory.
      if (params.kind === "checkout_switch") {
        if (!params.directory || !isAbsolute(params.directory)) {
          return refuseExit(sessionId, "The absolute checkout directory is not resolved.")
        }

        return refuseExit(sessionId, "This plugin has no cooperating checkout launcher.")
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

  pi.on("session_stop", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    const decision = exitDecisions.get(sessionId)
    if (!decision || decision.kind === "refused") {
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
