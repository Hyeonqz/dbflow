# DBFlow

**Self-hosted database change management with mandatory review and approval.**

DBFlow is not a migration tool. Flyway and Liquibase optimize for *automation speed* — DBFlow optimizes for *controlled procedure*. It is built for organizations where every database change must pass through a human-reviewed, auditable workflow before it touches a real database: finance, government, and enterprise infrastructure teams operating under internal controls or regulatory requirements.

Every change follows the same path, with a named person responsible at each step:

```
Draft → Submit → Review (designated reviewer) → Approval (designated approver) → Backup → Apply
```

Skipping human review is not a configuration option. That is the point.

## Features

- **Multi-step approval workflow** — a strict state machine (`DRAFT → SUBMITTED → REVIEW → FINAL`) with designated reviewers and approvers per request, full status history, and role-based visibility (Developer / Reviewer / Approver / Admin)
- **Custom approval policies** — per-environment approver counts with unanimous sign-off, plus approval delegation for absences (separation-of-duties aware)
- **Safe apply engine** — per-environment policies (e.g. auto-apply on DEV, approval-gated on STAGING/PROD), SQL risk linting with configurable severities (`DISABLED / INFO / WARN / BLOCK`), dry-run, automatic pre-apply backup, and rollback
- **Target database registry** — managed MySQL targets with AES-256-GCM encrypted credentials
- **Schema diff generator** — compare a desired schema against a live target database and turn the generated DDL into a draft change request
- **Audit log** — append-only (trigger-enforced) audit trail with filtering, search, and CSV/JSON export
- **Notifications** — Telegram notifications to assigned reviewers/approvers

## Quickstart

Requirements: Node.js 22+, [pnpm](https://pnpm.io) 9+, Docker.

```bash
./start.sh --seed
```

This starts MySQL (Docker), applies Prisma migrations, seeds demo users, and launches the API (`:3001`) and web UI (`:3000`).

Open http://localhost:3000 and log in with a demo account (password: `password1234`):

| Account | Role |
|---|---|
| `dev@dbflow.io` | Developer |
| `dba@dbflow.io` | Reviewer |
| `approver@dbflow.io` | Approver |

Stop with `./stop.sh` (add `--all` to stop MySQL too).

## Configuration

Copy `.env.example` to `apps/api/.env` (done automatically by `start.sh`) and adjust:

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL connection string for DBFlow's own database |
| `JWT_SECRET` | Secret for signing access tokens — **change in production** |
| `APP_ENCRYPTION_KEY` | 32-byte hex key for target-DB credential encryption (`openssl rand -hex 32`) |
| `TELEGRAM_BOT_TOKEN` | Optional; enables Telegram notifications |
| `BACKUP_MAX_ROWS` | Max rows per table captured in pre-apply data snapshots (default `100000`) |

## Project layout

pnpm workspace monorepo:

- `apps/api` — NestJS 10 + Prisma + MySQL backend
- `apps/web` — Next.js 14 (App Router) + Tailwind frontend
- `docker/` — local MySQL compose file

Run the API test suite with `pnpm api:test`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE)
