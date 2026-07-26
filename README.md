# DBFlow

**Self-hosted database change management with mandatory review and approval.**

DBFlow is not a migration tool. Flyway and Liquibase optimize for *automation speed* — DBFlow optimizes for *controlled procedure*. It is built for organizations where every database change must pass through a human-reviewed, auditable workflow before it touches a real database: finance, government, and enterprise infrastructure teams operating under internal controls or regulatory requirements.

Every change follows the same path, with a named person responsible at each step:

```
Draft → Submit → Review (designated reviewer) → Approval (designated approver(s)) → Backup → Apply
```

Skipping human review is not a configuration option. That is the point.

Run it on your own infrastructure, like Keycloak: set your secrets, point it at MySQL, and `docker compose up`.

## Features

- **Multi-step approval workflow** — a strict state machine (`DRAFT → SUBMITTED → REVIEW → FINAL → APPLIED`) with designated reviewers and approvers per request, full status history, and role-based visibility (Developer / Reviewer / Approver / Admin).
- **Per-environment approval policy** — configurable required-approver count per environment; unanimous sign-off to finalize, any rejection rejects immediately; concurrency-safe under a row lock.
- **Absence delegation** — reviewers/approvers can delegate authority to a same-role colleague for a date range; delegated actions are fully attributed (who acted, on whose behalf).
- **Separation of duties (SoD)** — one person can fill at most one approver slot per request (direct or delegated), always enforced.
- **Apply windows & freeze periods** — approved changes apply only inside admin-defined maintenance windows; blackout/freeze periods (quarter-end, audits) take precedence.
- **Safe apply engine** — env-aware SQL risk linting with configurable severities (`DISABLED / INFO / WARN / BLOCK`), dry-run preview, automatic pre-apply backup, and rollback.
- **Target database registry** — managed MySQL targets with AES-256-GCM encrypted credentials and connection testing.
- **Schema diff generator** — compare a desired schema against a live target database and turn the generated DDL into a draft change request.
- **Append-only audit log** — trigger-enforced (UPDATE/DELETE blocked) audit trail with filtering, search, and CSV/JSON export; secrets and SQL bodies are never logged.
- **Admin** — user management with pagination, role filter, and name/email search.

## Quick start (self-hosting)

Requires Docker and Docker Compose.

```bash
git clone https://github.com/Hyeonqz/dbflow.git
cd dbflow
cp .env.example .env
```

Edit `.env` and set real values — the app **refuses to boot with default or weak secrets**:

```bash
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → APP_ENCRYPTION_KEY
```

At minimum set `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, and the initial admin (`DBFLOW_ADMIN_EMAIL` / `DBFLOW_ADMIN_PASSWORD`). Then:

```bash
docker compose up -d
```

Open **http://localhost:3000** and sign in with the admin credentials you set. The API runs its own migrations on startup and creates the initial admin on first boot (Keycloak-style). Only the web port (3000) is published; the API and MySQL stay on the internal network.

> **Evaluation only:** set `DBFLOW_DEMO=true` to seed four demo accounts (password `password1234`), sample SQL-review rules, and default approval policies. Never enable this in production.

### Run from prebuilt images (Docker Hub)

DBFlow ships as a **single image** that runs both the web and API — one pull, one port. To skip the local build and use the published image, use `docker-compose.hub.yml`. Set the image namespace and version in `.env` (or your environment):

```bash
DBFLOW_IMAGE_NAMESPACE=<docker-hub-namespace>   # e.g. your Docker Hub username
DBFLOW_VERSION=v0.1.0                            # omit for :latest
```

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

The image (`<namespace>/dbflow`) is built for `linux/amd64` + `linux/arm64` and published by the `docker-publish` GitHub Actions workflow on each `v*` tag.

## Configuration

All configuration is via environment variables — see `.env.example` for the annotated list.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | MySQL connection string. In Compose it is derived from `MYSQL_PASSWORD`. |
| `JWT_SECRET` | yes | Access-token secret. Boot fails if unset, default, or < 16 chars. `openssl rand -hex 32`. |
| `APP_ENCRYPTION_KEY` | yes | AES-256-GCM key (64 hex chars) for target-DB credentials. Boot fails if all-zero. |
| `DBFLOW_ADMIN_EMAIL` / `DBFLOW_ADMIN_PASSWORD` | yes* | Initial admin, created once on first boot. *Not required if `DBFLOW_DEMO=true`. |
| `DBFLOW_DEMO` | no | `true` seeds demo accounts/policies for evaluation. Off by default. |
| `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` | yes (Compose) | Credentials for the bundled MySQL service. |
| `DBFLOW_CORS_ORIGINS` | no | Comma-separated allowed origins if the API is exposed directly. |
| `BACKUP_MAX_ROWS` | no | Max rows per table snapshotted in a pre-apply backup (schema-only above this). Default `100000`. |
| `PORT` | no | API port (default `3001`). |
| `TZ` | no | Server timezone; apply-window evaluation assumes `Asia/Seoul`. |

## Production deployment

The bundled stack serves plain HTTP on port 3000. For production — TLS termination, real client IPs in the audit log, and a hardening checklist — put a reverse proxy in front. See **[docs/deployment.md](docs/deployment.md)**.

## Development

For local development (dev-mode apps against a Dockerized MySQL, with demo accounts seeded):

```bash
./start.sh    # MySQL (Docker) → migrations → API (:3001) + web (:3000)
./stop.sh     # stop the apps ( --all also stops MySQL )
```

`start.sh` generates strong secrets into `apps/api/.env` on first run and boots with `DBFLOW_DEMO=true`. Demo login (password `password1234`):

| Account | Role |
|---|---|
| `dev@dbflow.io` | Developer |
| `dba@dbflow.io` | Reviewer |
| `approver@dbflow.io` | Approver |
| `admin@dbflow.io` | Admin |

Run the API test suite with `pnpm --filter @dbflow/api test`.

## Project layout

pnpm workspace monorepo:

- `apps/api` — NestJS 10 + Prisma 5 + MySQL 8 backend
- `apps/web` — Next.js 14 (App Router) + Tailwind CSS frontend
- `docker/` — local development MySQL compose file and the image entrypoint
- root `Dockerfile` — the single self-hosting image (web + API); `docker-compose.yml` at the root is the full stack

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md) — please do **not** open a public issue.

## License

DBFlow is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0) — see [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to make your modified source available to its users. For a commercial license without AGPL obligations, contact the maintainer.
