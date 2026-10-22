import { readFileSync } from "node:fs"
import { join } from "node:path"

const EXIT_DIRECTIVE = "(?:please\\s+)?(?:exit(?:\\s+after\\s+this(?:\\s+now)?)?|quit)"
const CONVERSATIONAL_EXIT_COMMANDS = [
  "farewell",
  "bye(?:\\s+for\\s+now)?",
  "see\\s+you(?:\\s+(?:later|soon|around))?",
  "catch\\s+you\\s+later",
  "talk\\s+to\\s+you\\s+later",
  "take\\s+care",
  "until\\s+next\\s+time",
  "have\\s+a\\s+(?:good|great)\\s+(?:day|night)",
]
const CONVERSATIONAL_EXIT_DIRECTIVE =
  `(?:(?:thanks|thank\\s+you|sounds\\s+good)(?:\\s*[,!?]\\s*|\\s+and\\s+|\\s+))?(?:${CONVERSATIONAL_EXIT_COMMANDS.join("|")})`
const EXIT_COMMAND_PATTERN = new RegExp(
  `^(?:${EXIT_DIRECTIVE}|${CONVERSATIONAL_EXIT_DIRECTIVE})[.!?]*$`,
  "i"
)
// Keep separator whitespace outside a prompt capture ending in a non-whitespace character.
// Overlapping whitespace captures can block the input hook on large pasted prompts.
const PROMPT_EXIT_PATTERNS = [EXIT_DIRECTIVE, CONVERSATIONAL_EXIT_DIRECTIVE].flatMap(
  (directive) => [
    new RegExp(`^(.*?\\S)\\s*[,;]\\s*${directive}[.!?]*$`, "is"),
    new RegExp(`^(.+?)[.!?]\\s+${directive}[.!?]*$`, "is"),
    new RegExp(`^(.*?\\S)\\s+(?:and\\s+)?then\\s+${directive}[.!?]*$`, "is"),
    new RegExp(`^(.*?\\S)\\s+and\\s+${directive}[.!?]*$`, "is"),
  ]
)

export default function exitCommandExtension(pi) {
  pi.setLabel("Exit Command")

  const exitAfterResponseSessions = new Set()

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui" || ctx.agent.kind !== "main" || !isOmpiLaunch()) {
      return
    }

    const sessionId = ctx.sessionManager.getSessionId()
    const write = process.stderr.write

    // OMP has no public resume-command override. Adapt only its final native
    // hint, after shutdown hooks, without printing a second hint or owning exit.
    process.stderr.write = function (chunk, ...args) {
      if (typeof chunk === "string") {
        const plain = chunk.replace(/\x1b\[[0-9;]*m/g, "")
        const hint = plain.match(
          /^\nResume this session with\nomp(?: --profile [a-z0-9][a-z0-9._-]{0,63})? (?:--resume|-r) ([^\s]+)\n$/
        )

        if (hint?.[1] === sessionId) {
          process.stderr.write = write
          return write.call(this, chunk.replace("omp ", "ompi "), ...args)
        }
      }

      return write.call(this, chunk, ...args)
    }
  })

  pi.on("input", (event, ctx) => {
    const input = event.text.trim()

    if (isExitCommand(input)) {
      pi.events.emit("omp-exit-command:exit-requested", {
        sessionId: ctx.sessionManager.getSessionId(),
      })

      ctx.abort()

      return { text: "/exit" }
    }

    if (hasTrailingExitDirective(input)) {
      exitAfterResponseSessions.add(ctx.sessionManager.getSessionId())
    }
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

function isExitCommand(input) {
  return EXIT_COMMAND_PATTERN.test(input)
}

function hasTrailingExitDirective(input) {
  return PROMPT_EXIT_PATTERNS.some((pattern) => pattern.test(input))
}

function isOmpiLaunch() {
  const directory = process.env.OMP_INSTANCE_CONTROL_LAUNCH_DIR
  const token = process.env.OMP_INSTANCE_CONTROL_LAUNCH_TOKEN
  if (!directory || !token) return false

  try {
    const launch = JSON.parse(readFileSync(join(directory, "launch.json"), "utf8"))

    // Nested OMP processes inherit these variables, but not the wrapper parent.
    return launch.version === 1 && launch.token === token && launch.pid === process.ppid
  } catch {
    return false
  }
}
