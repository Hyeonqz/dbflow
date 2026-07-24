# Contributing to DBFlow

Thanks for your interest in contributing!

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your environment (OS, Node.js version).

## Development setup

Requirements: Node.js 22+, pnpm 9+, Docker.

```bash
./start.sh          # MySQL (Docker) + migrations + demo users + API :3001 + Web :3000
pnpm api:test       # run the API test suite
./stop.sh --all     # tear everything down
```

`start.sh` boots in development mode with demo accounts seeded (`DBFLOW_DEMO=true`). Demo accounts are listed in the [README](README.md#development).

## Pull requests

1. Fork and create a branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. Add or update tests for anything behavioral; `pnpm api:test` must pass.
4. Note that DBFlow's core principle is **controlled procedure**: changes that bypass or weaken the review/approval workflow (e.g. auto-apply without human sign-off) will not be accepted as defaults.

## Reporting security issues

Do **not** open a public issue for vulnerabilities — follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0), the license DBFlow is distributed under. The maintainer may additionally offer DBFlow under a separate commercial license; if a CLA is required for that, it will be requested on your first pull request.
