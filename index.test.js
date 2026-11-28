import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

test("when an exit suggestion supersedes a deterministic arm, only the matching session exits once", async () => {
  // Arrange
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

  // Act
  const result = await executeExitTool(tools.exit_with_follow_up, {
    kind: "suggestion",
    suggestion: "printf '%s\\n' 'just text'",
  }, context)

  // Assert
  assert.match(result, /Nothing was run or queued/)
  assert.deepEqual(exitRequests, [])
  assert.equal(context.shutdowns, 0)
  assert.equal(context.aborted, false)

  // Act
  await session_stop({}, otherContext)

  // Assert
  assert.deepEqual(exitRequests, ["session-b"])
  assert.equal(otherContext.shutdowns, 1)
  assert.equal(context.shutdowns, 0)

  // Act
  await session_stop({}, context)
  await session_stop({}, context)

  // Assert
  assert.deepEqual(exitRequests, ["session-b", "session-a"])
  assert.equal(context.shutdowns, 1)
})

test("when a checkout switch is refused or wrap-up is blocked, only a fresh standalone exit closes the session", async () => {
  // Arrange
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

      // Act
      const result = await executeExitTool(tools.exit_with_follow_up, decision, context)
      const retry = await executeExitTool(tools.exit_after_response, ordinaryExit, context)
      const suggestionRetry = await executeExitTool(tools.exit_with_follow_up, {
        kind: "suggestion",
        suggestion: "not an acceptable fallback",
      }, context)

      await session_stop({}, context)
      const continuationRetry = await executeExitTool(tools.exit_after_response, ordinaryExit, context)
      await session_stop({}, context)

      // Assert
      assert.match(result, reason)
      assert.match(retry, /staying open/)
      assert.match(suggestionRetry, /staying open/)
      assert.match(continuationRetry, /staying open/)
      assert.deepEqual(exitRequests, [])
      assert.equal(context.shutdowns, 0)
      assert.equal(context.aborted, false)
    }

    // Act
    const immediate = await input({
      type: "input",
      text: "exit",
      source: "interactive",
    }, context)

    // Assert
    assert.deepEqual(immediate, {
      text: "/exit",
    })
    assert.deepEqual(exitRequests, ["test-session"])
    assert.equal(context.aborted, true)
    assert.equal(context.shutdowns, 0)
  }
})

test("when a checkout switch is approved, the canonical path is shown literally and the launcher commits only after the final reply", async (t) => {
  // Arrange
  const { input, session_stop, tools, events, exitRequests } = loadHandlers(exitCommandExtension, aiExitExtension)
  const context = createContext("session-a")
  const directory = makeCheckout(t, "with spaces; $(not-run) [name]")
  const alias = join(directory, "..", "symlink")
  symlinkSync(directory, alias)
  const { promise, approve } = heldApproval()
  const launcherCalls = recordLauncher(events)
  context.ui.confirm = (title, detail, options) => {
    assert.equal(title, "Open a fresh ompi session?")
    assert.equal(detail, directory)
    assert.equal(options.initialIndex, 1)
    assert.equal(options.signal.aborted, false)
    return promise
  }
  await input({
    type: "input",
    text: "Finish wrapping up, then exit.",
    source: "interactive",
  }, context)

  // Act
  const approval = requestCheckout(tools, context, alias)

  // Assert
  assert.deepEqual(launcherCalls, [])
  assert.equal(context.shutdowns, 0)

  // Act
  approve()
  const result = await approval
  const ordinaryRetry = await executeExitTool(tools.exit_after_response, {
    reason: "Old plain exit.",
  }, context)
  const suggestionRetry = await executeExitTool(tools.exit_with_follow_up, {
    kind: "suggestion",
    suggestion: "not a fallback",
  }, context)
  const checkoutRetry = await requestCheckout(tools, context, "/tmp")
  await session_stop(finalReply("session-b"), context)
  await session_stop(finalReply("session-a"), createContext("session-b"))

  // Assert
  assert.match(result, /approved and prepared/)
  assert.match(ordinaryRetry, /already in progress/)
  assert.match(suggestionRetry, /already in progress/)
  assert.match(checkoutRetry, /already in progress/)
  assert.deepEqual(launcherCalls, [
    ["prepare", {
      sessionId: "session-a",
      directory,
    }],
  ])
  assert.equal(context.shutdowns, 0)

  // Act
  await session_stop(finalReply("session-a"), context)
  await session_stop(finalReply("session-a"), context)

  // Assert
  assert.deepEqual(launcherCalls.slice(1), [
    ["commit", {
      sessionId: "session-a",
      ticket: "ticket-a",
    }],
  ])
  assert.deepEqual(exitRequests, [])
  assert.equal(context.shutdowns, 0, "the launcher alone requests shutdown")
})

test("when checkout approval is not explicit, the switch is refused and same-turn exit is blocked", async (t) => {
  // Arrange
  const directory = makeCheckout(t)
  for (const answer of [false, undefined, "Yes", new Error("dialog failed")]) {
    const { session_stop, tools, events, exitRequests } = loadHandlers(aiExitExtension)
    const context = createContext()
    const launcherCalls = recordLauncher(events)
    context.ui.confirm = async () => {
      if (answer instanceof Error) throw answer

      return answer
    }

    // Act
    const refusal = await requestCheckout(tools, context, directory)
    const retry = await executeExitTool(tools.exit_after_response, {
      reason: "Try a plain exit.",
    }, context)
    await session_stop(finalReply("test-session"), context)

    // Assert
    assert.match(refusal, /not approved/)
    assert.match(retry, /staying open/)
    assert.match(context.notices[0], /not approved.*staying open/)
    assert.deepEqual(launcherCalls, [])
    assert.deepEqual(exitRequests, [])
    assert.equal(context.shutdowns, 0)
  }
})

test("when the checkout path is unresolved or unsafe or the session is not the main terminal, neither the dialog nor the launcher runs", async (t) => {
  // Arrange
  const directory = makeCheckout(t)
  const parent = join(directory, "..")
  const unsafeDirectory = join(parent, "bidi\u202Echeckout")
  const disguisedPath = join(parent, "safe alias")
  mkdirSync(unsafeDirectory)
  symlinkSync(unsafeDirectory, disguisedPath)

  for (const [destination, mode, kind, reason] of [
    [directory, "tui", "sub", /main interactive terminal/],
    [directory, "rpc", "main", /main interactive terminal/],
    ["relative", "tui", "main", /not resolved/],
    [join(parent, "missing"), "tui", "main", /missing/],
    [join(directory, "bell\u0007name"), "tui", "main", /safely displayed/],
    [disguisedPath, "tui", "main", /safely displayed/],
  ]) {
    const { tools, events } = loadHandlers(aiExitExtension)
    const context = createContext()
    context.mode = mode
    context.agent.kind = kind
    let confirmations = 0
    context.ui.confirm = async () => {
      confirmations += 1
      return true
    }
    const launcherCalls = recordLauncher(events)

    // Act
    const refusal = await requestCheckout(tools, context, destination)

    // Assert
    assert.match(refusal, reason)
    assert.equal(confirmations, 0)
    assert.deepEqual(launcherCalls, [])
    assert.equal(context.shutdowns, 0)
  }
})

test("when the launcher returns a value without mutating the envelope, the switch is unsupported and no exit is armed", async (t) => {
  // Arrange
  const { tools, session_stop, events, exitRequests } = loadHandlers(aiExitExtension)
  const context = createContext()
  const directory = makeCheckout(t)
  events.on("omp-instance-control:fresh-launch:prepare", () => ({
    status: "accepted",
    ticket: "not-in-the-envelope",
  }))

  // Act
  const refusal = await requestCheckout(tools, context, directory)
  await session_stop(finalReply("test-session"), context)

  // Assert
  assert.match(refusal, /no cooperating checkout launcher/)
  assert.match(context.notices[0], /no cooperating checkout launcher/)
  assert.deepEqual(exitRequests, [])
  assert.equal(context.shutdowns, 0)
})

test("when the launcher refuses preparation, the session stays open and shows the error", async (t) => {
  // Arrange
  const { tools, session_stop, events, exitRequests } = loadHandlers(aiExitExtension)
  const context = createContext()
  const directory = makeCheckout(t)
  events.on("omp-instance-control:fresh-launch:prepare", (envelope) => {
    envelope.result = {
      status: "refused",
      message: "A fresh launch is already prepared for this terminal.",
    }
  })

  // Act
  const refusal = await requestCheckout(tools, context, directory)
  const retry = await executeExitTool(tools.exit_after_response, {
    reason: "Try a plain exit.",
  }, context)
  await session_stop(finalReply("test-session"), context)

  // Assert
  assert.match(refusal, /already prepared/)
  assert.match(context.notices[0], /already prepared/)
  assert.match(retry, /staying open/)
  assert.deepEqual(exitRequests, [])
  assert.equal(context.shutdowns, 0)
})

test("when approval arrives after user input or another interruption, no ticket is prepared", async (t) => {
  // Arrange
  const directory = makeCheckout(t)
  for (const interruption of ["input", "session_switch", "abort", "replace_directory"]) {
    const handlers = loadHandlers(aiExitExtension)
    const { tools, events, session_stop, exitRequests } = handlers
    const context = createContext()
    const { promise, approve } = heldApproval()
    const cancellation = new AbortController()
    const launcherCalls = recordLauncher(events)
    let dialogSignal
    context.ui.confirm = (_title, _detail, options) => {
      dialogSignal = options.signal
      return promise
    }

    // Act
    const approval = requestCheckout(tools, context, directory, cancellation.signal)
    if (interruption === "input") {
      await handlers.input({
        source: "interactive",
        text: "Keep this terminal open.",
      }, context)
    } else if (interruption === "session_switch") {
      await handlers.session_switch({}, createContext("other-session"))
    } else if (interruption === "abort") {
      cancellation.abort()
    } else {
      renameSync(directory, `${directory}-original`)
      mkdirSync(directory)
    }
    approve()
    const refusal = await approval
    await session_stop(finalReply("test-session"), context)

    // Assert
    assert.match(refusal, /staying open/)
    assert.equal(dialogSignal.aborted, true)
    assert.deepEqual(launcherCalls, [])
    assert.deepEqual(exitRequests, [])
    assert.equal(context.shutdowns, 0)
  }
})

test("when an approved checkout is abandoned, its ticket is cancelled without falling back to exit", async (t) => {
  // Arrange
  const directory = makeCheckout(t)
  for (const interruption of ["input", "session_switch", "abort", "agent_end", "session_shutdown", "failed_reply", "queued_input"]) {
    const handlers = loadHandlers(exitCommandExtension, aiExitExtension)
    const { tools, events, session_stop, exitRequests } = handlers
    const context = createContext()
    const cancellation = new AbortController()
    const launcherCalls = recordLauncher(events)

    // Act
    const preparation = await requestCheckout(tools, context, directory, cancellation.signal)
    if (interruption === "input") {
      await handlers.input({
        source: "interactive",
        text: "Summarize the cancellation, then exit.",
      }, context)
    } else if (interruption === "session_switch") {
      await handlers.session_switch({}, createContext("other-session"))
    } else if (interruption === "abort") {
      cancellation.abort()
    } else if (interruption === "failed_reply") {
      await session_stop(finalReply("test-session", "error"), context)
    } else if (interruption === "queued_input") {
      context.hasPendingMessages = () => true
    } else {
      await handlers[interruption]({}, context)
    }
    await session_stop(finalReply("test-session"), context)

    // Assert
    assert.match(preparation, /prepared/)
    assert.deepEqual(launcherCalls, [
      ["prepare", {
        sessionId: "test-session",
        directory,
      }],
      ["cancel", {
        sessionId: "test-session",
        ticket: "ticket-a",
      }],
    ], interruption)
    assert.match(context.notices[0], /Checkout switch refused/)
    assert.deepEqual(exitRequests, [])
    assert.equal(context.shutdowns, 0)
  }
})

test("when the launcher refuses to commit, the error is shown safely and the ticket is cancelled without falling back to exit", async (t) => {
  // Arrange
  const directory = makeCheckout(t)
  for (const [message, displayed] of [
    ["The approved directory changed after preparation.", /approved directory changed/],
    ["\u001B[31munsafe launcher output\u001B[0m", /launcher did not commit/],
  ]) {
    const { tools, events, session_stop, exitRequests } = loadHandlers(aiExitExtension)
    const context = createContext()
    const launcherCalls = recordLauncher(events, (envelope) => {
      envelope.result = {
        status: "refused",
        message,
      }
    })

    // Act
    await requestCheckout(tools, context, directory)
    await session_stop(finalReply("test-session"), context)
    const retry = await executeExitTool(tools.exit_after_response, {
      reason: "Try a plain exit.",
    }, context)
    await session_stop(finalReply("test-session"), context)

    // Assert
    assert.deepEqual(launcherCalls.slice(1), [
      ["commit", {
        sessionId: "test-session",
        ticket: "ticket-a",
      }],
      ["cancel", {
        sessionId: "test-session",
        ticket: "ticket-a",
      }],
    ])
    assert.match(context.notices[0], displayed)
    assert.doesNotMatch(context.notices[0], /unsafe launcher output/)
    assert.match(retry, /staying open/)
    assert.deepEqual(exitRequests, [])
    assert.equal(context.shutdowns, 0)
  }
})

test("when a follow-up suggestion contains shell syntax, it remains literal output after teardown", () => {
  // Arrange
  const suggestion = "printf '%s\\n' '$(touch not-run); text'\n# A second copyable line"

  // Act
  const result = runSuggestionExit({
    suggestion,
  })

  // Assert
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `native shutdown requested\nterminal teardown finished\n\nSuggestion only — not run\n${suggestion}\n`)
  assert.equal(result.stderr, "")
})

test("when a suggestion is absent, blank, or unsafe for the terminal, exit prints a no-guess notice", () => {
  // Arrange
  for (const suggestion of [undefined, "  \t\n", "echo\x1b]0;title\x07\x9b31m\rcommand"]) {
    // Act
    const result = runSuggestionExit({
      suggestion,
    })

    // Assert
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "native shutdown requested\nterminal teardown finished\n\nSuggestion only — not run\nNo useful next action could be suggested.\n")
    assert.equal(result.stderr, "")
  }
})

test("when the matching session does not stop or the process fails, no suggestion is printed", () => {
  // Arrange
  const suggestion = "keep me out of other exits"

  // Act
  const withoutStop = runSuggestionExit({
    suggestion,
    skipStop: true,
  })

  const failedExit = runSuggestionExit({
    suggestion,
    exitCode: 1,
  })

  // Assert
  assert.equal(withoutStop.status, 0, withoutStop.stderr)
  assert.equal(withoutStop.stdout, "terminal teardown finished\n")
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

function makeCheckout(t, name = "checkout") {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "omp-checkout-test-"))
  t.after(() => rmSync(root, {
    recursive: true,
    force: true,
  }))
  const directory = join(root, name)
  mkdirSync(directory)
  return directory
}

function heldApproval() {
  let approve
  const promise = new Promise((resolve) => {
    approve = () => resolve(true)
  })
  return {
    promise,
    approve,
  }
}

function finalReply(sessionId, stopReason = "stop") {
  return {
    session_id: sessionId,
    last_assistant_message: {
      stopReason,
      content: [
        {
          type: "text",
          text: "Wrapped up.",
        },
      ],
    },
  }
}

async function requestCheckout(tools, context, directory, signal) {
  const result = await tools.exit_with_follow_up.execute("switch-tool-call", {
    kind: "checkout_switch",
    directory,
  }, signal, undefined, context)
  return result.content[0].text
}

function recordLauncher(events, commit = (envelope) => {
  envelope.result = {
    status: "committed",
  }
}) {
  const calls = []
  const prefix = "omp-instance-control:fresh-launch:"
  events.on(`${prefix}prepare`, (envelope) => {
    calls.push(["prepare", {
      ...envelope,
    }])
    envelope.result = {
      status: "accepted",
      ticket: "ticket-a",
    }
  })
  events.on(`${prefix}commit`, (envelope) => {
    calls.push(["commit", {
      ...envelope,
    }])
    commit(envelope)
  })
  events.on(`${prefix}cancel`, (envelope) => {
    calls.push(["cancel", {
      ...envelope,
    }])
    envelope.result = {
      status: "cancelled",
    }
  })
  return calls
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

  pi.events.hasListeners = (event) => pi.events.listenerCount(event) > 0
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
    events: pi.events,
    tools,
    exitRequests,
  }
}

function createContext(sessionId = "test-session") {
  const notices = []
  return {
    mode: "tui",
    hasUI: true,
    notices,
    ui: {
      async confirm() {
        return true
      },
      notify(message) {
        notices.push(message)
      },
    },
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
