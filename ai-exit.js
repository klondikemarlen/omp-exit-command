import { ExitLifecycle } from "./exit-lifecycle.js"

const NEXT_SESSION_STOP_KEY = "__next_session_stop__"

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
      const sessionContext = args.find(isSessionContext)
      const sessionKey = ExitLifecycle.getSessionKey(sessionContext) ?? NEXT_SESSION_STOP_KEY

      exitAfterResponseSessions.add(sessionKey)
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
    const sessionKey = ExitLifecycle.getSessionKey(ctx)

    if (exitAfterResponseSessions.has(sessionKey)) {
      exitAfterResponseSessions.delete(sessionKey)
    } else if (exitAfterResponseSessions.has(NEXT_SESSION_STOP_KEY)) {
      exitAfterResponseSessions.delete(NEXT_SESSION_STOP_KEY)
    } else {
      return
    }

    ExitLifecycle.finish(ctx)
  })
}

function isSessionContext(value) {
  return Boolean(value?.sessionManager || value?.sessionId)
}
