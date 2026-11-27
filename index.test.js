import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
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

test("an exit suggestion supersedes a deterministic arm and waits for this session to stop", async () => {
  const { input, session_stop, tools, exitRequests } = loadHandlers(exitCommandExtension, aiExitExtension)
  const context = createContext("session-a")
  const otherContext = createContext("session-b")
  await input({
    type: "input",
    text: "Propose a shell command for later, then exit.",
    source: "interactive",
  }, context)
  await input({
    type: "input",
    text: "Summarize and exit.",
    source: "interactive",
  }, otherContext)

  const result = await executeExitTool(tools.exit_with_follow_up, {
    kind: "suggestion",
    suggestion: "printf '%s\\n' 'just text'",
  }, context)
  assert.match(result, /Nothing was run or queued/)
  assert.deepEqual(exitRequests, [])
  assert.equal(context.shutdowns, 0)
  assert.equal(context.aborted, false)

  await session_stop({}, otherContext)
  assert.deepEqual(exitRequests, ["session-b"])
  assert.equal(otherContext.shutdowns, 1)
  assert.equal(context.shutdowns, 0)

  await session_stop({}, context)
  await session_stop({}, context)
  assert.deepEqual(exitRequests, ["session-b", "session-a"])
  assert.equal(context.shutdowns, 1)
})

test("a checkout refusal or blocked wrap-up cancels both exit routes and stays open", async () => {
  for (const [decision, reason] of [
    [
      {
        kind: "checkout_switch",
        directory: "/tmp/check out;not a command",
      },
      /no cooperating checkout launcher/,
    ],
    [
      {
        kind: "checkout_switch",
      },
      /checkout directory is not resolved/,
    ],
    [
      {
        kind: "wrap_up_blocked",
        reason: "Required verification did not pass.",
      },
      /wrap-up has not succeeded/,
    ],
  ]) {
    const { input, session_stop, tools, exitRequests } = loadHandlers(exitCommandExtension, aiExitExtension)
    const context = createContext()

    // A refusal must cancel both deterministic and already-armed AI exits.
    for (const armOrdinaryAiExit of [false, true]) {
      await input({
        type: "input",
        text: "Finish the work, then exit.",
        source: "interactive",
      }, context)
      const ordinaryExit = {
        reason: "Exit as requested.",
      }
      if (armOrdinaryAiExit) {
        await executeExitTool(tools.exit_after_response, ordinaryExit, context)
      }

      const result = await executeExitTool(tools.exit_with_follow_up, decision, context)
      assert.match(result, reason)
      const retry = await executeExitTool(tools.exit_after_response, ordinaryExit, context)
      assert.match(retry, /staying open/)
      const suggestionRetry = await executeExitTool(tools.exit_with_follow_up, {
        kind: "suggestion",
        suggestion: "not an acceptable fallback",
      }, context)
      assert.match(suggestionRetry, /staying open/)

      await session_stop({}, context)
      const continuationRetry = await executeExitTool(tools.exit_after_response, ordinaryExit, context)
      assert.match(continuationRetry, /staying open/)
      await session_stop({}, context)
      assert.deepEqual(exitRequests, [])
      assert.equal(context.shutdowns, 0)
      assert.equal(context.aborted, false)
    }

    const immediate = await input({
      type: "input",
      text: "exit",
      source: "interactive",
    }, context)
    assert.deepEqual(immediate, {
      text: "/exit",
    })
    assert.deepEqual(exitRequests, ["test-session"])
    assert.equal(context.aborted, true)
    assert.equal(context.shutdowns, 0)
  }
})

test("a follow-up suggestion remains literal in terminal output after teardown", () => {
  const suggestion = "printf '%s\\n' '$(touch not-run); text'\n# A second copyable line"
  const result = runSuggestionExit({
    suggestion,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `native shutdown requested\nterminal teardown finished\n\nSuggestion only — not run\n${suggestion}\n`)
  assert.equal(result.stderr, "")
})

test("an absent, blank, or terminal-control suggestion prints no invented command", () => {
  for (const suggestion of [undefined, "  \t\n", "echo\x1b]0;title\x07\x9b31m\rcommand"]) {
    const result = runSuggestionExit({
      suggestion,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "native shutdown requested\nterminal teardown finished\n\nSuggestion only — not run\nNo useful next action could be suggested.\n")
    assert.equal(result.stderr, "")
  }
})

test("a suggestion cannot replay after unrelated teardown or failed exit", () => {
  const withoutStop = runSuggestionExit({
    suggestion: "keep me out of other exits",
    skipStop: true,
  })
  assert.equal(withoutStop.status, 0, withoutStop.stderr)
  assert.equal(withoutStop.stdout, "terminal teardown finished\n")

  const failedExit = runSuggestionExit({
    suggestion: "keep me out of failed exits",
    exitCode: 1,
  })
  assert.equal(failedExit.status, 1, failedExit.stderr)
  assert.equal(failedExit.stdout, "native shutdown requested\nterminal teardown finished\n")
})

test("when a prompt ends with an exit phrase, it runs before shutdown", async () => {
  // Arrange
  for (const prompt of [
    "do X and exit",
    "do X then exit!",
    "do X, exit after this",
    "do some thing; exit",
    "do X. exit",
    "Thanks, and exit!",
    "do X, farewell",
    "do X and take care",
    "do X. see you later",
    "do X, thanks and farewell",
    "do X and thanks! bye for now.",
    "summarize a, b; then exit",
    "summarize  this , ; and exit",
    "summarize\n  these notes, exit",
    "summarize\n  these notes. exit",
    "summarize\n  these notes then exit",
    "summarize\n  these notes and exit",
    "summarize\n  these notes. see you later",
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
    assert.equal(result, undefined, prompt)
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
  assert.equal(result, undefined)
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

async function executeExitTool(tool, params, context) {
  const result = await tool.execute("tool-call-id", params, undefined, undefined, context)
  return result.content[0].text
}

function runSuggestionExit(options) {
  const script = `
    import { EventEmitter } from "node:events"
    import aiExitExtension from "./ai-exit.js"

    ${loadHandlers.toString()}
    ${createContext.toString()}
    ${executeExitTool.toString()}

    const { suggestion, skipStop, exitCode } = JSON.parse(process.argv[1])
    const { session_stop, session_shutdown, tools } = loadHandlers(aiExitExtension)
    const context = createContext("matching-session")
    context.shutdown = () => console.log("native shutdown requested")

    await executeExitTool(tools.exit_with_follow_up, { kind: "suggestion", suggestion }, context)
    if (!skipStop) {
      await session_stop({}, context)
    }
    await session_shutdown({}, createContext("other-session"))
    await session_shutdown({}, context)
    await session_shutdown({}, context)
    console.log("terminal teardown finished")
    process.exitCode = exitCode ?? 0
  `

  return spawnSync(process.execPath, ["--input-type=module", "--eval", script, JSON.stringify(options)], {
    cwd: new URL(".", import.meta.url),
    encoding: "utf8",
  })
}

function loadHandlers(...extensions) {
  const eventHandlers = {}
  const exitRequests = []
  const tools = {}
  const schema = {
    describe() {
      return this
    },
    optional() {
      return this
    },
  }
  const pi = {
    events: new EventEmitter(),
    setLabel() {},
    on(eventName, handler) {
      eventHandlers[eventName] ??= []
      eventHandlers[eventName].push(handler)
    },
    registerTool(tool) {
      tools[tool.name] = tool
    },
    zod: {
      enum() {},
      object(shape) {
        return { shape }
      },
      string() {
        return schema
      },
    },
  }

  pi.events.on("omp-exit-command:exit-requested", ({ sessionId }) => exitRequests.push(sessionId))

  for (const extension of extensions.length ? extensions : [exitCommandExtension]) {
    extension(pi)
  }

  const handlers = {}
  for (const [eventName, callbacks] of Object.entries(eventHandlers)) {
    handlers[eventName] = async (event, ctx) => {
      let result
      for (const callback of callbacks) {
        const response = await callback(event, ctx)
        if (response !== undefined) {
          result = response
        }
      }
      return result
    }
  }

  return {
    ...handlers,
    tools,
    exitRequests,
  }
}

function createContext(sessionId = "test-session") {
  return {
    mode: "tui",
    agent: {
      kind: "main",
    },
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
