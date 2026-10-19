# Maintainer guide

This knowledge base explains the integration contracts and verification needed to change the plugin without losing prompts or bypassing OMP teardown.

- [Product behavior and installation](/README.md): supported commands, examples, and the AI feature toggle.
- [Architecture and runtime contracts](/docs/architecture/runtime-contracts.md): module responsibilities, parsing precedence, session identity, shutdown ownership, and the JavaScript decision.
- [Verification and release](/docs/workflows/verification-and-release.md): automated checks, large-input smoke, interactive acceptance scenarios, and released-artifact verification.

The README owns intended user behavior. Runtime source owns the implementation; tests and interactive QA establish observed behavior. Keep individual change reports, measurements, and release evidence in their issue or pull request rather than adding a second history here.

These documents are public and included in the package. Do not add credentials, private prompts, saved session transcripts, or workstation-specific paths. There is no separate documentation-site publication pipeline.
