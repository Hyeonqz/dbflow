# Production deployment

The `docker compose` stack is complete but intentionally minimal: it publishes **only the web port (3000) over plain HTTP**, with the API and MySQL kept on the internal Docker network. That is fine for evaluation and internal networks, but a production deployment — especially in the regulated environments DBFlow targets — needs two things this stack deliberately leaves to you:

1. **TLS termination** — DBFlow does not terminate TLS itself. Put a reverse proxy in front.
2. **Real client IPs in the audit log** — without a proxy that sets `X-Forwarded-For`, the append-only audit trail records the internal web-container IP instead of the actual client.

Both are solved by running a TLS-terminating reverse proxy in front of the web service.

## Architecture

```
                                          ┌─ app container ────────────────────┐
client ──HTTPS──▶ reverse proxy ──HTTP──▶ │ Next.js :3000 ──▶ NestJS :3001     │ ──▶ mysql:3306
        (TLS)      (nginx/Caddy)          │ (web)   same-origin proxy   (api)  │
                                          └────────────────────────────────────┘
```

DBFlow ships as a **single image**: one container runs both the web and API processes, and only port 3000 is published. The web side proxies `/api/*` to the API over the container's loopback interface, and the API trusts one proxy hop (`trust proxy` is enabled) so it reads the client IP from `X-Forwarded-For`. You only add the outermost TLS layer.

## Option A — Caddy (simplest, automatic TLS)

Caddy obtains and renews Let's Encrypt certificates automatically. `Caddyfile`:

```
dbflow.example.com {
    reverse_proxy app:3000
}
```

Add Caddy to your compose (or run it separately on the same network). It sets `X-Forwarded-For` and `X-Forwarded-Proto` by default — no extra config needed for the audit-IP chain to work.

## Option B — nginx (bring your own certs)

```nginx
server {
    listen 443 ssl;
    server_name dbflow.example.com;

    ssl_certificate     /etc/ssl/certs/dbflow.crt;
    ssl_certificate_key /etc/ssl/private/dbflow.key;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;  # real client IP → audit log
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}

# redirect HTTP → HTTPS
server {
    listen 80;
    server_name dbflow.example.com;
    return 301 https://$host$request_uri;
}
```

`$proxy_add_x_forwarded_for` appends the client address, so the API's audit log captures the true client IP. If you run **more than one** proxy hop in front of DBFlow, increase the API's trusted-hop count accordingly (the API currently trusts exactly one — `trust proxy: 1` in `apps/api/src/main.ts`).

## Production checklist

- **Strong secrets** — `JWT_SECRET` and `APP_ENCRYPTION_KEY` must be real (`openssl rand -hex 32`). The API refuses to boot with default/weak values, so this is enforced, not optional.
- **`DBFLOW_DEMO=false`** — never seed demo accounts (password `password1234`) in production. Provision the first admin via `DBFLOW_ADMIN_EMAIL` / `DBFLOW_ADMIN_PASSWORD` instead.
- **Keep MySQL unpublished** — the default compose exposes only the app's port 3000. Do not add a host port mapping for `mysql`, and do not expose the API's 3001 out of the container; all API traffic should flow through the same-origin web proxy behind TLS.
- **`DBFLOW_CORS_ORIGINS`** — only needed if you expose the API directly to browsers (not the case with the reverse-proxy setup above). Leave unset otherwise.
- **Database backups** — application backups taken before each apply are stored **in** the MySQL database, so they share the `dbflow_mysql_data` volume's fate. Back up that volume (or `mysqldump`) on your own schedule; losing the volume loses both the data and its pre-apply backups.
- **Timezone** — set `DBFLOW_TZ` to your operating timezone (IANA name, e.g. `Europe/Berlin`). Apply windows and freeze periods are evaluated in it, so a `09:00–18:00` window means 09:00–18:00 *there*. Defaults to `Asia/Seoul`. An invalid zone name refuses to boot rather than silently falling back.
