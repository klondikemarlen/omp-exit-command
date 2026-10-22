import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const SESSION_ID = "019c625b-b900-7000-8000-000000000001"
const NATIVE_HINT = `\nResume this session with\nomp --resume ${SESSION_ID}\n`
const WRAPPED_HINT = `\nResume this session with\nompi --resume ${SESSION_ID}\n`
const CHILD_SCRIPT = `
  import extension from "./index.js"

  const handlers = {}
  extension({
    setLabel() {},
    on(event, handler) { handlers[event] = handler },
  })
  const { chunks, kind, mode } = JSON.parse(process.argv[1])
  handlers.session_shutdown({}, {
    agent: { kind },
    mode,
    sessionManager: { getSessionId() { return "${SESSION_ID}" } },
  })
  for (const chunk of chunks) {
    if (chunk.buffer) {
      process.stderr.write(Buffer.from(chunk.text))
    } else {
      process.stderr.write(chunk.text, "utf8")
    }
  }
`

function emitShutdownOutput(t, {
  managed = true,
  record = {},
  chunks = [{ text: NATIVE_HINT }],
  kind = "main",
  mode = "tui",
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "exit-resume-test-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = { ...process.env }
  delete env.OMP_INSTANCE_CONTROL_LAUNCH_DIR
  delete env.OMP_INSTANCE_CONTROL_LAUNCH_TOKEN

  if (managed) {
    env.OMP_INSTANCE_CONTROL_LAUNCH_DIR = directory
    env.OMP_INSTANCE_CONTROL_LAUNCH_TOKEN = "test-launch-token"
    writeFileSync(join(directory, "launch.json"), JSON.stringify({
      version: 1,
      token: "test-launch-token",
      pid: process.pid,
      ...record,
    }))
  }

  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    CHILD_SCRIPT,
    JSON.stringify({ chunks, kind, mode }),
  ], {
    cwd: import.meta.dirname,
    env,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  return result
}

test("when the wrapper owns the main terminal, its resume hint uses ompi", (t) => {
  // Arrange
  const chunks = [{ text: NATIVE_HINT }]

  // Act
  const result = emitShutdownOutput(t, { chunks })

  // Assert
  assert.equal(result.stderr, WRAPPED_HINT)
})

test("when the native hint includes a profile and color, both survive launcher substitution", (t) => {
  // Arrange
  const chunks = [{
    text: `\n\x1b[2mResume this session with\x1b[22m\n\x1b[2momp --profile work --resume ${SESSION_ID}\x1b[22m\n`,
  }]

  // Act
  const result = emitShutdownOutput(t, { chunks })

  // Assert
  assert.equal(result.stderr, `\n\x1b[2mResume this session with\x1b[22m\n\x1b[2mompi --profile work --resume ${SESSION_ID}\x1b[22m\n`)
})

test("when OMP is unwrapped, the native resume hint stays unchanged", (t) => {
  // Arrange
  const managed = false

  // Act
  const result = emitShutdownOutput(t, { managed })

  // Assert
  assert.equal(result.stderr, NATIVE_HINT)
})

test("when a nested process inherits launcher variables, the native hint stays unchanged", (t) => {
  // Arrange
  const record = { pid: process.ppid }

  // Act
  const result = emitShutdownOutput(t, { record })

  // Assert
  assert.equal(result.stderr, NATIVE_HINT)
})

test("when the launcher token does not match, the native hint stays unchanged", (t) => {
  // Arrange
  const record = { token: "another-launch" }

  // Act
  const result = emitShutdownOutput(t, { record })

  // Assert
  assert.equal(result.stderr, NATIVE_HINT)
})

test("when shutdown writes diagnostics or another session hint, only the active native hint changes", (t) => {
  // Arrange
  const diagnostic = "Diagnostic: omp --resume another-session\n"
  const otherHint = "\nResume this session with\nomp --resume another-session\n"
  const chunks = [
    { text: diagnostic, buffer: true },
    { text: otherHint },
    { text: NATIVE_HINT },
    { text: diagnostic },
  ]

  // Act
  const result = emitShutdownOutput(t, { chunks })

  // Assert
  assert.equal(result.stderr, diagnostic + otherHint + WRAPPED_HINT + diagnostic)
})

test("when an RPC session shuts down, native output stays unchanged", (t) => {
  // Arrange
  const mode = "rpc"

  // Act
  const result = emitShutdownOutput(t, { mode })

  // Assert
  assert.equal(result.stderr, NATIVE_HINT)
})

test("when a subagent shuts down, native output stays unchanged", (t) => {
  // Arrange
  const kind = "subagent"

  // Act
  const result = emitShutdownOutput(t, { kind })

  // Assert
  assert.equal(result.stderr, NATIVE_HINT)
})
