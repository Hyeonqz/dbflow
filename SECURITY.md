# Security Policy

DBFlow handles database credentials and enforces approval controls, so we take security seriously. Thank you for helping keep it and its users safe.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/Hyeonqz/dbflow/security/advisories/new) (Security → Report a vulnerability), or
- email to the maintainer at **wlsgusrb78@naver.com** with the subject line `DBFlow security`.

Please include:

- a description of the vulnerability and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version / commit, and
- any suggested remediation.

We will acknowledge your report within a few business days, keep you updated on progress, and credit you in the release notes once a fix is published (unless you prefer to remain anonymous). Please give us a reasonable window to release a fix before any public disclosure.

## Scope

Security-relevant areas include, but are not limited to:

- authentication and session handling (JWT),
- role-based access control and the review/approval workflow gates,
- encryption of stored target-database credentials (AES-256-GCM),
- the audit log's append-only (tamper-evident) guarantees,
- SQL handling on the apply path, and secret handling / environment validation.

## Operating DBFlow securely

- **Never** run with default or demo secrets in production. The app refuses to boot with a default/weak `JWT_SECRET` or an all-zero `APP_ENCRYPTION_KEY`; generate strong values with `openssl rand -hex 32`.
- Do not enable `DBFLOW_DEMO=true` in production — it seeds well-known demo accounts.
- Keep `APP_ENCRYPTION_KEY` backed up and rotated per your policy; losing it makes stored target-DB credentials unrecoverable.
- Run the web tier behind TLS, and restrict `DBFLOW_CORS_ORIGINS` if you expose the API directly.
- Keep the database and images updated; subscribe to releases for security fixes.

## Supported versions

DBFlow is pre-1.0 and evolving. Security fixes are applied to the latest release on `main`. Pin to a released tag for production and upgrade promptly when security releases are published.
