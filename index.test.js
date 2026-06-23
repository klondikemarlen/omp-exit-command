import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"

import exitCommandExtension from "./index.js"

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
    if (typeof chunk === "string" && chunk.startsWith("Resume this session with ")) {
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

test("plain exit prints the same resume command as /exit", async () => {
  const { input } = loadHandlers()
  const context = createContext({
    sessionManager: {
      getSessionId() {
        return "019ef626-a280-7000-91ea-80f4553cef59"
      },
    },
  })

  const result = await input("exit", context)
  await waitForScheduledExit()

  assert.deepEqual(result, { action: "handled" })
  assert.equal(context.aborted, true)
  assert.equal(context.shutdowns, 1)
  assert.equal(
    stdout,
    "Resume this session with omp --resume 019ef626-a280-7000-91ea-80f4553cef59\n"
  )
  assert.deepEqual(exitCodes, [0])
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
    "Resume this session with omp --resume 019ef624-20de-7000-88cc-5ab98a37cbe2\n"
  )
})

test("non-exit input continues normally", async () => {
  const { input } = loadHandlers()
  const context = createContext()

  const result = await input("help", context)

  assert.deepEqual(result, { action: "continue" })
  assert.equal(stdout, "")
  assert.deepEqual(exitCodes, [])
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 0)
})

function loadHandlers() {
  const handlers = {}

  exitCommandExtension({
    setLabel() {},
    on(eventName, handler) {
      handlers[eventName] = handler
    },
  })

  return handlers
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
