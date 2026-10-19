# Verification and release

## Automated gate

Run from the repository root:

```sh
npm test
npm pack --dry-run
git diff --check
```

There is no Docker wrapper, compiler, formatter, or separate CI gate configured. The test suite uses `node:test` and public OMP-shaped callbacks: `{ type: "input", text, source: "interactive" }`, a session manager exposing `getSessionId()`, and the tool context in argument five. Cover observable classification, unchanged prompt content, session isolation, and one-shot exit consumption. Do not assert copied native output wording in a unit mock; verify native output in a real process.

For a committed branch, check whitespace against the PR base (`git diff origin/main...HEAD --check`); for staged changes use `git diff --cached --check`.

## Large-input smoke

This exercises both ordinary conversation and prompt-and-exit without a model call. It checks results, prints diagnostic timings, and bounds the whole process rather than encoding a machine-specific latency threshold in a unit test:

```sh
timeout 10s node --input-type=module <<'JS'
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import extension from "./index.js"

const handlers = {}
extension({
  setLabel() {},
  on(event, handler) { handlers[event] = handler },
})
const ctx = {
  sessionManager: { getSessionId() { return "smoke-session" } },
  abort() { throw new Error("Unexpected immediate exit") },
  shutdown() { throw new Error("Unexpected shutdown before session_stop") },
}
const prompt = "word " + " ".repeat(200_000) + "ordinary content"
const started = performance.now()
assert.equal(handlers.input({ type: "input", text: prompt, source: "interactive" }, ctx), undefined)
assert.deepEqual(
  handlers.input({ type: "input", text: prompt + " and exit", source: "interactive" }, ctx),
  { text: prompt },
)
console.log(`Both large-input paths passed in ${(performance.now() - started).toFixed(1)} ms`)
JS
```

## Interactive acceptance

Use a disposable saved session, not an ongoing work session. Local development can load only this checkout's entry points:

```sh
omp --no-extensions -e ./index.js -e ./ai-exit.js --no-title
```

Send a short ordinary prompt once to create a saved session. For output comparison, resume the same session separately for native `/exit` and each extension path. Replace `SESSION_ID` with that test session's ID:

```sh
omp --resume SESSION_ID --no-extensions --no-title
omp --resume SESSION_ID --no-extensions -e ./index.js -e ./ai-exit.js --no-title
```

| Scenario | Action | Required result |
| --- | --- | --- |
| Native baseline | In the first command, type `/exit` | OMP completes teardown and shows the saved-session resume information. |
| Immediate | In the extension command, type `Thanks! Bye for now.` | No model prompt; native teardown and the same session information exactly once. |
| Deferred | Type `Reply with exactly EXIT_OK and exit` | The prompt reaches the model without the directive; the reply finishes before native shutdown. |
| AI-assisted | Ask the assistant to call `exit_after_response` and then reply | The tool schedules shutdown for its own session; the final reply finishes before exit. |
| Unsaved session | Start with an empty temporary session directory, then type `exit` | Match native `/exit` for that same setup; do not fabricate a resume hint. |
| Autocomplete | Type `/exi`, press Tab, then Enter | Native `/exit` is offered, completed, and executed. |

An additional temporary extension can await a short asynchronous operation in `session_shutdown` and write a unique completion marker. Confirm the marker appears before the final native session information, then remove the probe. Do not weaken teardown or change model/provider routes to make QA pass. A live model/advisor failure is an external limitation to report, not proof of a plugin regression or permission to change defaults.

## Release and installed-artifact verification

1. Capture the change and acceptance criteria in an issue; use an issue-named branch and linked pull request. Complete self-review and the relevant checks above before merge.
2. Bump `package.json` for the release. Merge the verified pull request to `main`; update the local default branch from the remote.
3. Remove the installed copy, then install the merged GitHub artifact:

   ```sh
   omp plugin uninstall omp-exit-command
   omp plugin install github:klondikemarlen/omp-exit-command
   omp plugin list
   ```

4. Confirm the installed version matches the merged manifest. The distribution channel is GitHub; do not claim an npm-registry publication from a GitHub install.
5. Start a **new OMP process** using normal plugin discovery, without `--no-extensions` or local `-e` overrides. Exercise the changed behavior and native exit autocomplete. Existing processes may retain extension modules loaded at startup; `/reload-plugins` is not a substitute for fresh-process release evidence.
6. Record actual review, QA, release/install evidence, learner coverage, and blockers in the canonical PR body. Confirm a clean synchronized default branch and preserve any user-owned branches or worktrees.

Remove disposable probes and test sessions afterward. Keep release-specific measurements and transcripts out of the durable knowledge base.
