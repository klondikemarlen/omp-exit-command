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

## Behavior

- `exit` is consumed by the OMP input hook.
- The active turn is aborted.
- The same resume command printed by `/exit` is written to stdout.
- OMP shutdown is requested.
- A next-tick process exit prevents the prompt from reaching the chat model.
- Prompts ending in `then exit` are sent without that suffix, then the same resume/shutdown/exit flow runs from OMP's `session_stop` hook after the main-session response completes.
- The `then exit` flow requires an OMP runtime that emits the `session_stop` extension hook.
