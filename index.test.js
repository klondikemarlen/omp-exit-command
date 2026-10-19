import assert from "node:assert/strict"
import { test } from "node:test"

import exitCommandExtension from "./index.js"
import aiExitExtension from "./ai-exit.js"

async function assertImmediateExit(prompt) {
  const { input } = loadHandlers()
  const context = createContext()

  const result = await input(prompt, context)

  assert.deepEqual(result, { text: "/exit" }, prompt)
  assert.equal(context.aborted, true, prompt)
  assert.equal(context.shutdowns, 0, prompt)
}

test("immediate exit commands route to native /exit before reaching the model", async () => {
  for (const prompt of [
    "exit",
    "quit",
    "Please exit after this now?",
    "farewell",
    "thank you, farewell",
    "bye",
    "bye for now",
    "BYE FOR NOW?",
    "thanks, bye for now",
    "sounds good! bye for now.",
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
    await assertImmediateExit(prompt)
  }
})

test("input hook exits for the reported courteous bye-for-now request", async () => {
  await assertImmediateExit("Thanks! Bye for now.")
})

test("non-exit input continues normally", async () => {
  for (const prompt of [
    "help",
    "goodbye",
    "thanks and goodbye",
    "explain why people say farewell",
    "explain why people say bye for now",
    'explain “bye for now”',
    'write "take care" in a message',
  ]) {
    const { input } = loadHandlers()
    const context = createContext()

    const result = await input(prompt, context)

    assert.equal(result, undefined, prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)
  }
})

test("base input hook does not infer non-command exit requests", async () => {
  const { input } = loadHandlers()
  const context = createContext()

  const result = await input("tell me how to exit vim", context)

  assert.equal(result, undefined)
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 0)
})

test("AI exit tool schedules exit on session stop", async () => {
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const context = createContext({
    sessionId: "019ef626-a280-7000-91ea-80f4553cef59",
  })

  await tools.exit_after_response.execute(
    "tool-call-id",
    { reason: "User asked OMP to exit after the response." },
    undefined,
    context
  )
  assert.equal(context.shutdowns, 0)

  await session_stop({}, context)
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 1)
})

test("AI exit tool falls back to the next session stop without context", async () => {
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const context = createContext({
    sessionId: "session-a",
  })

  await tools.exit_after_response.execute("tool-call-id", { reason: "exit after response" })
  await session_stop({}, context)

  assert.equal(context.shutdowns, 1)
})

test("AI exit tool ignores another session stop", async () => {
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const contextA = createContext({
    sessionId: "session-a",
  })

  const contextB = createContext({
    sessionId: "session-b",
  })

  await tools.exit_after_response.execute("tool-call-id", { reason: "exit after response" }, undefined, contextA)
  await session_stop({}, contextB)

  assert.equal(contextB.shutdowns, 0)

  await session_stop({}, contextA)

  assert.equal(contextA.shutdowns, 1)
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
    const { input, session_stop } = loadHandlers()
    const context = createContext({
      sessionId: "019ef626-a280-7000-91ea-80f4553cef59",
    })

    const result = await input(prompt, context)

    assert.deepEqual(result, { text }, prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)

    await session_stop({}, context)

    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 1, prompt)
  }
})

test("trailing exit ignores another session stop", async () => {
  const { input, session_stop } = loadHandlers()
  const contextA = createContext({
    sessionManager: {
      sessionFile: "/sessions/project/2026-10-19_session-a.jsonl",
    },
  })
  const contextB = createContext({
    sessionManager: {
      sessionFile: "/sessions/project/2026-10-19_session-b.jsonl",
    },
  })

  assert.deepEqual(await input("do X and exit", contextA), { text: "do X" })
  await session_stop({}, contextB)

  assert.equal(contextB.shutdowns, 0)

  await session_stop({}, contextA)

  assert.equal(contextA.shutdowns, 1)
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
    shutdown() {
      this.shutdowns += 1
    },
    ...overrides,
  }
}
