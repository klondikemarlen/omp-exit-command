# omp-exit-command

Oh My Pi plugin that exits the app when you type plain `exit`.

## Install

```bash
omp install github:klondikemarlen/omp-exit-command
```

For local development:

```bash
omp install ~/code/klondikemarlen/omp-exit-command
```

Restart or reload OMP after installing.

## Behavior

- `exit` is consumed by the OMP input hook.
- The active turn is aborted.
- The same resume command printed by `/exit` is written to stdout.
- OMP shutdown is requested.
- A next-tick process exit prevents the prompt from reaching the chat model.
