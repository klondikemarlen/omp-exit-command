import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"

import exitCommandExtension from "./index.js"
import aiExitExtension from "./ai-exit.js"

async function assertImmediateExit(prompt) {
  const { input } = loadHandlers()
  const context = createContext()

  const result = await input({
    type: "input",
    text: prompt,
    source: "interactive",
  }, context)

  assert.deepEqual(result, { text: "/exit" }, prompt)
  assert.equal(context.aborted, true, prompt)
  assert.equal(context.shutdowns, 0, prompt)
}

test("when input is an immediate exit command, native /exit runs before the model", async () => {
  // Arrange
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
    // Act / Assert
    await assertImmediateExit(prompt)
  }
})

test("when input is the reported courteous bye-for-now request, native exit runs", async () => {
  // Arrange
  const { input } = loadHandlers()
  const context = createContext()

  // Act
  const result = await input({
    type: "input",
    text: "Thanks! Bye for now.",
    source: "interactive",
  }, context)

  // Assert
  assert.deepEqual(result, { text: "/exit" })
  assert.equal(context.aborted, true)
  assert.equal(context.shutdowns, 0)
})

test("when input is not an exit command, conversation continues normally", async () => {
  // Arrange
  for (const prompt of [
    "help",
    "goodbye",
    "thanks and goodbye",
    "explain why people say farewell",
    "explain why people say bye for now",
    'explain “bye for now”',
    'write "take care" in a message',
    "Explain the word exit.\nThen continue with examples.",
    "Tell me how to\nexit vim",
    'Write this sentence:\n"Then exit."',
    "Summarize these notes and exit\nThen keep working.",
  ]) {
    const { input } = loadHandlers()
    const context = createContext()

    // Act
    const result = await input({
      type: "input",
      text: prompt,
      source: "interactive",
    }, context)

    // Assert
    assert.equal(result, undefined, prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)
  }
})

test("when input asks how to exit another program, OMP does not exit", async () => {
  // Arrange
  const { input } = loadHandlers()
  const context = createContext()

  // Act
  const result = await input({
    type: "input",
    text: "tell me how to exit vim",
    source: "interactive",
  }, context)

  // Assert
  assert.equal(result, undefined)
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 0)
})

test("when the AI requests exit, shutdown runs once after the response", async () => {
  // Arrange
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const context = createContext("session-a")

  // Act
  await tools.exit_after_response.execute(
    "tool-call-id",
    { reason: "User asked OMP to exit after the response." },
    undefined,
    undefined,
    context
  )

  // Assert
  assert.equal(context.shutdowns, 0)

  // Act
  await session_stop({}, context)

  // Assert
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 1)

  // Act
  await session_stop({}, context)

  // Assert
  assert.equal(context.shutdowns, 1)
})

test("when another session stops, the AI exit request remains pending", async () => {
  // Arrange
  const { session_stop, tools } = loadHandlers(aiExitExtension)
  const contextA = createContext("session-a")
  const contextB = createContext("session-b")

  // Act
  await tools.exit_after_response.execute(
    "tool-call-id",
    { reason: "exit after response" },
    undefined,
    undefined,
    contextA
  )
  await session_stop({}, contextB)

  // Assert
  assert.equal(contextB.shutdowns, 0)

  // Act
  await session_stop({}, contextA)

  // Assert
  assert.equal(contextA.shutdowns, 1)
})

test("when a prompt ends with an exit phrase, it runs before shutdown", async () => {
  // Arrange
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
    ["do X and thanks! bye for now.", "do X and thanks"],
    ["summarize a, b; then exit", "summarize a, b"],
    ["summarize  this , ; and exit", "summarize  this"],
    ["summarize\n  these notes, exit", "summarize\n  these notes"],
    ["summarize\n  these notes. exit", "summarize\n  these notes"],
    ["summarize\n  these notes then exit", "summarize\n  these notes"],
    ["summarize\n  these notes and exit", "summarize\n  these notes"],
    ["summarize\n  these notes. see you later", "summarize\n  these notes"],
  ]) {
    const { input, session_stop } = loadHandlers()
    const context = createContext("session-a")

    // Act
    const result = await input({
      type: "input",
      text: prompt,
      source: "interactive",
    }, context)

    // Assert
    assert.deepEqual(result, { text }, prompt)
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 0, prompt)

    // Act
    await session_stop({}, context)

    // Assert
    assert.equal(context.aborted, false, prompt)
    assert.equal(context.shutdowns, 1, prompt)
  }
})

test("when compound cleanup instructions end with Then exit, they finish before shutdown", async () => {
  // Arrange
  const { input, session_stop } = loadHandlers()
  const context = createContext()
  const prompt = "Clean up after youself post merge.\n\nDate mine for insights and file any relevant github issues with upstream https://github.com/klondikemarlen/marlens-skills-rules-and-tools or related projects."

  // Act
  const result = await input({
    type: "input",
    text: `${prompt}\nThen exit.`,
    source: "interactive",
  }, context)

  // Assert
  assert.deepEqual(result, { text: prompt })
  assert.equal(context.aborted, false)
  assert.equal(context.shutdowns, 0)

  // Act
  await session_stop({}, context)

  // Assert
  assert.equal(context.shutdowns, 1)
})

test("when the active session changes, deferred exit follows the session id", async () => {
  // Arrange
  const { input, session_stop } = loadHandlers()
  let activeSessionId = "session-a"
  const context = createContext()
  context.sessionManager.getSessionId = () => activeSessionId

  // Act
  await input({
    type: "input",
    text: "do X and exit",
    source: "interactive",
  }, context)

  activeSessionId = "session-b"
  await session_stop({}, context)

  // Assert
  assert.equal(context.shutdowns, 0)

  // Act
  activeSessionId = "session-a"
  await session_stop({}, context)
  await session_stop({}, context)

  // Assert
  assert.equal(context.shutdowns, 1)
})

function loadHandlers(extension = exitCommandExtension) {
  const handlers = {}
  const tools = {}
  const pi = {
    events: new EventEmitter(),
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

function createContext(sessionId = "test-session") {
  return {
    sessionManager: {
      getSessionId() {
        return sessionId
      },
    },
    aborted: false,
    shutdowns: 0,
    abort() {
      this.aborted = true
    },
    shutdown() {
      this.shutdowns += 1
    },
  }
}
