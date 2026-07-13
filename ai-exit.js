import { finishExit, getSessionKey } from "./exit-lifecycle.js"

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
      exitAfterResponseSessions.add(getSessionKey(args.find(isSessionContext)) ?? NEXT_SESSION_STOP_KEY)
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
    const fallbackKey = NEXT_SESSION_STOP_KEY

    if (exitAfterResponseSessions.has(sessionKey)) {
      exitAfterResponseSessions.delete(sessionKey)
    } else if (exitAfterResponseSessions.has(fallbackKey)) {
      exitAfterResponseSessions.delete(fallbackKey)
    } else {
      return
    }

    finishExit(ctx)
  })
}

function isSessionContext(value) {
  return Boolean(value?.sessionManager || value?.sessionId)
}
