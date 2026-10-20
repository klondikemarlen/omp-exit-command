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
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      exitAfterResponseSessions.add(ctx.sessionManager.getSessionId())

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

  pi.on("session_stop", (_event, ctx) => {
    if (!exitAfterResponseSessions.delete(ctx.sessionManager.getSessionId())) {
      return
    }

    pi.events.emit("omp-exit-command:exit-requested", {
      sessionId: ctx.sessionManager.getSessionId(),
    })

    ctx.shutdown()
  })
}
