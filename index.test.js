import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"

import exitCommandExtension from "./index.js"
import aiExitExtension from "./ai-exit.js"
import packageJson from "./package.json" with { type: "json" }

let originalExit
let originalStdoutWrite
let stdout
let exitCodes

beforeEach(() => {
  stdout = ""
  exitCodes = []
  originalExit = process.exit
  originalStdoutWrite = process.stdout.write

  process.exit = (code) => {
    exitCodes.push(code)
  }

  process.stdout.write = (chunk, ...args) => {
    if (typeof chunk === "string" && chunk.includes("Resume this session with ")) {
      stdout += chunk
      return true
    }

    return originalStdoutWrite.call(process.stdout, chunk, ...args)
  }
})

afterEach(() => {
  process.exit = originalExit
  process.stdout.write = originalStdoutWrite
})

test("immediate exit commands print the same resume command as /exit", async () => {
  for (const prompt of [
    "exit",
    "quit",
    "Please exit after this now?",
    "farewell",
    "thank you, farewell",
    "see you",
    "see you later",
    "see you soon",
    "see you around",
    "catch you later",
    "talk to you later",
    "take care",
    "thank you take care",
    "until next time",
    "have a good day",
    "have a great night",
  ]) {
    stdout = ""
    exitCodes = []

    const { input } = loadHandlers()
    const context = createContext({
      sessionManager: {
        getSessionId() {
          return "019ef626-a280-7000-91ea-80f4553cef59"
        },
      },
    })

    const result = await input(prompt, context)
    await waitForScheduledExit()

    assert.deepEqual(result, { handled: true }, prompt)
    assert.equal(context.aborted, true, prompt)
    assert.equal(context.shutdowns, 1, prompt)
    assert.equal(
      stdout,
      "\nResume this session with omp --resume 019ef626-a280-7000-91ea-80f4553cef59\n",
      prompt
    )
    assert.deepEqual(exitCodes, [0], prompt)
  }
})

test("session id falls back to the session file name", async () => {
  const { input } = loadHandlers()
  const context = createContext({
    sessionManager: {
      sessionFile:
        "/home/user/.omp/agent/sessions/project/2026-06-23T20-20-23-390Z_019ef624-20de-7000-88cc-5ab98a37cbe2.jsonl",
    },
  })

  await input({ input: " exit " }, context)
  await waitForScheduledExit()

  assert.equal(
    stdout,
    "\nResume this session with omp --resume 019ef624-20de-7000-88cc-5ab98a37cbe2\n"
  )
})

test("non-exit input continues normally", async () => {
  for (const prompt of [
    "help",
    "goodbye",
    "bye for now",
    "thanks and bye",
    "explain why people say farewell",
    'write "take care" in a message',
  ]) {
    const { input } = loadHandlers()
    const context = createContext()

    const result = await input(prompt, context)

    assert.equal(result, undefined, prompt)
    assert.equal(stdout, "", prompt)
    assert.deepEqual(exitCodes, [], prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)
  }
})

test("manifest enables AI exit detection by default", () => {
  const feature = packageJson.omp.features["ai-exit-detection"]

  assert.equal(feature.default, true)
  assert.ok(feature.extensions.includes("./ai-exit.js"))
})

test("base extension does not register the AI exit tool", () => {
  const { tools } = loadHandlers()

  assert.equal(Object.hasOwn(tools, "exit_after_response"), false)
})

test("AI extension registers exit_after_response", () => {
  const { tools } = loadHandlers(aiExitExtension)

  assert.equal(tools.exit_after_response.name, "exit_after_response")
  assert.equal(typeof tools.exit_after_response.execute, "function")
})

test("base input hook does not infer non-command exit requests", async () => {
  const { input } = loadHandlers()
  const context = createContext()

  const result = await input("tell me how to exit vim", context)

  assert.equal(result, undefined)
  assert.equal(stdout, "")
  assert.deepEqual(exitCodes, [])
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 0)
})

test("AI exit tool schedules exit on session stop", async () => {
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const context = createContext({
    sessionManager: {
      getSessionId() {
        return "019ef626-a280-7000-91ea-80f4553cef59"
      },
    },
  })

  const result = await tools.exit_after_response.execute(
    "tool-call-id",
    { reason: "User asked OMP to exit after the response." },
    undefined,
    context
  )
  await session_stop({}, context)
  await waitForScheduledExit()

  assert.deepEqual(result, {
    content: [
      {
        type: "text",
        text: "OMP will exit after this response.",
      },
    ],
  })
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 1)
  assert.equal(
    stdout,
    "\nResume this session with omp --resume 019ef626-a280-7000-91ea-80f4553cef59\n"
  )
  assert.deepEqual(exitCodes, [0])
})

test("AI exit tool ignores another session stop", async () => {
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const contextA = createContext({
    sessionManager: {
      getSessionId() {
        return "session-a"
      },
    },
  })
  const contextB = createContext({
    sessionManager: {
      getSessionId() {
        return "session-b"
      },
    },
  })

  await tools.exit_after_response.execute("tool-call-id", { reason: "exit after response" }, undefined, contextA)
  await session_stop({}, contextB)
  await waitForScheduledExit()

  assert.equal(contextB.shutdowns, 0)
  assert.equal(stdout, "")
  assert.deepEqual(exitCodes, [])

  await session_stop({}, contextA)
  await waitForScheduledExit()

  assert.equal(contextA.shutdowns, 1)
  assert.equal(stdout, "\nResume this session with omp --resume session-a\n")
  assert.deepEqual(exitCodes, [0])
})



test("trailing exit phrases run the prompt before exiting on session stop", async () => {
  for (const [prompt, text] of [
    ["do X and exit", "do X"],
    ["do X then exit!", "do X"],
    ["do X, exit after this", "do X"],
    ["do some thing; exit", "do some thing"],
    ["do X. exit", "do X"],
    ["Thanks, and exit!", "Thanks"],
    ["do X, farewell", "do X"],
    ["do X and take care", "do X"],
    ["do X. see you later", "do X"],
    ["do X, thanks and farewell", "do X"],
  ]) {
    stdout = ""
    exitCodes = []

    const { input, session_stop } = loadHandlers()
    const context = createContext({
      sessionManager: {
        getSessionId() {
          return "019ef626-a280-7000-91ea-80f4553cef59"
        },
      },
    })

    const result = await input(prompt, context)

    assert.deepEqual(result, { text }, prompt)
    assert.equal(stdout, "", prompt)
    assert.deepEqual(exitCodes, [], prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)

    await session_stop({}, context)
    await waitForScheduledExit()

    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 1, prompt)
    assert.equal(
      stdout,
      "\nResume this session with omp --resume 019ef626-a280-7000-91ea-80f4553cef59\n",
      prompt
    )
    assert.deepEqual(exitCodes, [0], prompt)
  }
})

test("trailing exit ignores another session stop", async () => {
  const { input, session_stop } = loadHandlers()
  const contextA = createContext({
    sessionManager: {
      getSessionId() {
        return "session-a"
      },
    },
  })
  const contextB = createContext({
    sessionManager: {
      getSessionId() {
        return "session-b"
      },
    },
  })

  assert.deepEqual(await input("do X and exit", contextA), { text: "do X" })
  await session_stop({}, contextB)
  await waitForScheduledExit()

  assert.equal(contextB.shutdowns, 0)
  assert.equal(stdout, "")
  assert.deepEqual(exitCodes, [])

  await session_stop({}, contextA)
  await waitForScheduledExit()

  assert.equal(contextA.shutdowns, 1)
  assert.equal(stdout, "\nResume this session with omp --resume session-a\n")
  assert.deepEqual(exitCodes, [0])
})

function loadHandlers(extension = exitCommandExtension) {
  const handlers = {}
  const tools = {}
  const pi = {
    setLabel() {},
    on(eventName, handler) {
      handlers[eventName] = handler
    },
    registerTool(tool) {
      tools[tool.name] = tool
    },
    zod: {
      object(shape) {
        return { shape }
      },
      string() {
        return {
          describe(description) {
            return { description }
          },
        }
      },
    },
  }

  extension(pi)

  return { ...handlers, tools }
}

function createContext(overrides = {}) {
  return {
    aborted: false,
    shutdowns: 0,
    abort() {
      this.aborted = true
    },
    async shutdown() {
      this.shutdowns += 1
    },
    ...overrides,
  }
}

async function waitForScheduledExit() {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
