# omp-exit-command

Oh My Pi plugin that exits the app when you type an explicit exit command or a standalone conversational farewell.

## Install

Install the OMP plugin from GitHub:

```bash
omp plugin install github:klondikemarlen/omp-exit-command
```

`omp install github:klondikemarlen/omp-exit-command` also works; `omp plugin install` is clearer because this package ships an OMP runtime extension.

Update an already-installed GitHub plugin with the same command:

```bash
omp plugin install github:klondikemarlen/omp-exit-command
```

Then start a new OMP process. `/reload-plugins` may retain modules already loaded by the current process.

## Local development install

For normal use, install from GitHub as shown above. For development on a local checkout, link the local package so OMP loads your working tree instead of a pinned GitHub commit:

```bash
git clone https://github.com/klondikemarlen/omp-exit-command.git
cd omp-exit-command
npm test
omp plugin link "$PWD"
```

Start a new OMP process to exercise edits to `index.js`; `/reload-plugins` is not a fresh-process verification.

## Release process

See the [verification and release workflow](/docs/workflows/verification-and-release.md) for the test gate, native-exit parity checks, and fresh-process verification of the released GitHub artifact.

## Behavior

- Immediate exit commands are intercepted by the OMP input hook, abort the active turn, and route to native `/exit` before reaching the chat model. OMP completes its normal teardown and prints its session information, including the resume hint for persisted sessions; the plugin does not print a separate hint or force the process to exit.
- Immediate exit examples: `exit`, `quit`, `Please exit after this now?`.
- Conversational farewells also exit immediately: `farewell`, `bye` / `bye for now`, `see you` (including `see you later`, `soon`, or `around`), `catch you later`, `talk to you later`, `take care`, `until next time`, and `have a good day` / `have a great night`. They may be prefixed with `thanks`, `thank you`, or `sounds good`.
- Farewells are anchored commands: requests that mention or quote one, such as `explain why people say farewell`, continue normally.
- Prompt-and-exit commands send the prompt without the exit directive, then request native graceful shutdown from OMP's `session_stop` hook after the main-session response completes, preserving the same teardown and session output.
- With `ompi` 0.9.2 or newer, immediate, prompt-and-exit, and AI-assisted exits override a queued restart instead of reopening the session. Update both packages and start a new process; older wrappers and already-running pre-update processes still let a pending restart consume a graceful exit.
- Prompt-and-exit examples:
  - `do X and exit` → sends `do X`
  - `do X then exit!` → sends `do X`
  - `do X, exit after this` → sends `do X`
  - `do X; exit` → sends `do X`
  - `do X. exit` → sends `do X`
  - `Thanks, and exit!` → sends `Thanks`
  - `do X, farewell` → sends `do X`
  - `do X and take care` → sends `do X`
  - `do X. see you later` → sends `do X`
  - Multiline instructions may end with `Then exit.` on a separate line; preceding paragraphs and indentation are preserved.
- Prompt-and-exit requires an OMP runtime that emits the `session_stop` extension hook.

## AI-assisted exit detection

Model-assisted exit detection is enabled by default. It reuses OMP's active model; this plugin does not bundle a tokenizer or model.

To opt out, disable `ai-exit-detection`, then restart OMP or run `/reload-plugins`:

```bash
omp plugin features omp-exit-command --disable ai-exit-detection
```

Replace `--disable` with `--enable` to restore model-assisted detection.

When enabled, the plugin loads an `exit_after_response` tool. The assistant may call that tool when it decides the user clearly wants OMP to exit after the current response. Explicit `exit` / `quit` and the deterministic prompt-and-exit grammar remain active during this rollout.

The tool description tells the assistant not to call it for instructions about exiting other programs, such as `tell me how to exit vim`.

## Maintainer knowledge base

The [maintainer guide](/docs/README.md) covers runtime contracts, parsing and shutdown invariants, the JavaScript decision, and reproducible QA.
