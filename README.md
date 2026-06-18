# omp-exit-command

Oh My Pi plugin that exits the app when you type plain `exit`.

## Install

```bash
omp plugin install github:klondikemarlen/omp-exit-command
```

For local development:

```bash
omp plugin link ~/code/klondikemarlen/omp-exit-command
```

Restart or reload OMP after installing.

## Behavior

- `exit` is consumed by the OMP input hook.
- The active turn is aborted.
- OMP shutdown is requested.
- A next-tick process exit prevents the prompt from reaching the chat model.
