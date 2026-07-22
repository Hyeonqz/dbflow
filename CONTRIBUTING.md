# Contributing to DBFlow

Thanks for your interest in contributing!

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your environment (OS, Node.js version).

## Development setup

Requirements: Node.js 22+, pnpm 9+, Docker.

```bash
./start.sh --seed   # MySQL (Docker) + migrations + seed users + API :3001 + Web :3000
pnpm api:test       # run the API test suite
./stop.sh --all     # tear everything down
```

Demo accounts are listed in the [README](README.md#quickstart).

## Pull requests

1. Fork and create a branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. Add or update tests for anything behavioral; `pnpm api:test` must pass.
4. Note that DBFlow's core principle is **controlled procedure**: changes that bypass or weaken the review/approval workflow (e.g. auto-apply without human sign-off) will not be accepted as defaults.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
