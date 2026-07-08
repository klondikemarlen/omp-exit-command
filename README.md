# omp-exit-command

Oh My Pi plugin that exits the app when you type plain `exit`.

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

Then restart OMP or run `/reload-plugins`.

## Local development install

For normal use, install from GitHub as shown above. For development on a local checkout, link the local package so OMP loads your working tree instead of a pinned GitHub commit:

```bash
git clone https://github.com/klondikemarlen/omp-exit-command.git
cd omp-exit-command
npm test
omp plugin link "$PWD"
```

Local edits to `index.js` take effect after `/reload-plugins`.

## Release process

1. Bump `package.json`.
2. Run `npm test`.
3. Merge the pull request to `main`.
4. Install the merged remote version:

```bash
omp plugin install github:klondikemarlen/omp-exit-command
```

5. Verify `omp plugin list` shows the new `omp-exit-command` version.
6. Restart OMP or run `/reload-plugins`.

## Behavior

- Immediate exit commands are consumed by the OMP input hook, abort the active turn, print the same resume command as `/exit`, request shutdown, and schedule a next-tick process exit before the prompt reaches the chat model.
- Immediate exit examples: `exit`, `Please exit after this now?`.
- Prompt-and-exit commands send the prompt without the exit directive, then run the same resume/shutdown/exit flow from OMP's `session_stop` hook after the main-session response completes.
- Prompt-and-exit examples:
  - `do X and exit` → sends `do X`
  - `do X then exit!` → sends `do X`
  - `do X, exit after this` → sends `do X`
  - `do X; exit` → sends `do X`
  - `do X. exit` → sends `do X`
  - `Thanks, and exit!` → sends `Thanks`
- Prompt-and-exit requires an OMP runtime that emits the `session_stop` extension hook.

## AI-assisted exit detection

Deterministic grammar is the default because exit has side effects. To opt in to model-assisted detection, enable the `ai-exit-detection` feature in OMP's plugin settings UI, then restart OMP or run `/reload-plugins`.

The same feature can be enabled from the CLI:

```bash
omp plugin features omp-exit-command --enable ai-exit-detection
```

With the feature enabled, the plugin loads an `exit_after_response` tool. The assistant may call that tool when it decides the user clearly wants OMP to exit after the current response. The tool is not active by default, and deterministic `exit` / prompt-and-exit phrases still run without model interpretation.

The tool description tells the assistant not to call it for instructions about exiting other programs, such as `tell me how to exit vim`.
