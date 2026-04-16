# minimal-api

A minimal production-deployed REST API built with Node.js (Express), reverse-proxied through Nginx, and managed by systemd on a Linux VPS. Designed to demonstrate real-world API deployment architecture — not just a running server, but a correctly layered, failure-resilient system.

**Live:** [`https://api.mosesekerin.name.ng`](https://api.mosesekerin.name.ng)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [API Specification](#api-specification)
- [Local Development](#local-development)
- [Deployment Process](#deployment-process)
- [Request Flow](#request-flow)
- [Failure Scenarios](#failure-scenarios)
- [Performance](#performance)

---

## Overview

This project is a three-endpoint JSON API deployed on a Linux VPS. It is not a development server exposed directly to the internet — it follows the standard production pattern of binding the application to a loopback interface and routing all public traffic through a hardened reverse proxy.

**Stack:**

| Layer | Technology | Role |
|---|---|---|
| Application | Node.js + Express | Route handling, JSON responses |
| Reverse Proxy | Nginx | TLS termination, HTTP→HTTPS redirect, header injection |
| Process Manager | systemd | Boot persistence, crash recovery, log capture |
| TLS | Let's Encrypt (Certbot) | Certificate issuance and auto-renewal |
| Platform | Linux VPS | Ubuntu, single node |

The app process is intentionally not exposed to the public network. All traffic enters on port 443 (or 80, redirected), is handled by Nginx, and is forwarded internally to `127.0.0.1:3000`.

---

## Architecture

```
Client (Browser / curl)
         │
         │  HTTPS :443  (or HTTP :80 → 301 redirect to HTTPS)
         ▼
┌──────────────────────────┐
│          Nginx           │  ← TLS termination, HTTP redirect,
│      (Reverse Proxy)     │    proxy headers, security headers
└──────────────────────────┘
         │
         │  HTTP → 127.0.0.1:3000  (loopback only, not reachable externally)
         ▼
┌──────────────────────────┐
│     Node.js / Express    │  ← Route handling, JSON serialization,
│       (App Server)       │    response headers
└──────────────────────────┘
         │
         │  Process lifecycle (start, stop, restart on crash)
         ▼
┌──────────────────────────┐
│         systemd          │  ← Auto-start on boot, restart policy,
│    (Process Manager)     │    stdout/stderr → journald
└──────────────────────────┘
```

### Layer Responsibilities

**Nginx**
Handles everything at the network boundary. It terminates TLS (decrypts HTTPS), enforces HTTP→HTTPS redirects, injects forwarding headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) so the app knows the real client context, and adds security headers (`HSTS`, `X-Content-Type-Options`). Nginx is the only process that listens on public ports 80 and 443.

**Node.js / Express**
Handles only application logic: route matching, response construction, and JSON serialization. It has no awareness of TLS, no exposure to raw client IPs, and no responsibility for connection management at scale. `res.json()` sets `Content-Type: application/json` automatically.

**systemd**
Integrates the Node process into the OS lifecycle. It ensures the service starts after the network is available (`After=network.target`), restarts automatically on non-clean exits (`Restart=on-failure`), and captures all stdout/stderr into journald — no separate log daemon needed.

### Why `127.0.0.1` and not `0.0.0.0`

Binding to `0.0.0.0` would expose port 3000 on all network interfaces, including the public NIC. That means the app would be reachable directly from the internet, bypassing Nginx — with no TLS, no security headers, and no rate limiting. Binding to `127.0.0.1` restricts the socket to the loopback interface. Nginx, running on the same host, can still reach it. External traffic cannot, regardless of firewall state.

---

## API Specification

All endpoints return HTTP `200`, `Content-Type: application/json`, and respond in under 500ms.

### `GET /`

Returns a confirmation that the API process is running.

```
GET https://api.mosesekerin.name.ng/
```

**Response `200 OK`:**
```json
{
  "message": "API is running"
}
```

---

### `GET /health`

Liveness probe endpoint. Suitable for use by uptime monitors and load balancer health checks.

```
GET https://api.mosesekerin.name.ng/health
```

**Response `200 OK`:**
```json
{
  "message": "healthy"
}
```

---

### `GET /me`

Returns static identity information about the project author.

```
GET https://api.mosesekerin.name.ng/me
```

**Response `200 OK`:**
```json
{
  "name": "Ekerin Oluwatimileyin",
  "email": "mosesekerin@gmail.com",
  "github": "https://github.com/mosesekerin"
}
```

---

## Local Development

**Prerequisites:** Node.js ≥ 18, npm

```bash
# Clone and install
git clone https://github.com/mosesekerin/minimal-api.git
cd minimal-api
npm install

# Start the server
node app.js
# → Server running at http://127.0.0.1:3000
```

**Test all endpoints:**

```bash
curl -s http://127.0.0.1:3000/ | python3 -m json.tool
# { "message": "API is running" }

curl -s http://127.0.0.1:3000/health | python3 -m json.tool
# { "message": "healthy" }

curl -s http://127.0.0.1:3000/me | python3 -m json.tool
# { "name": "Ekerin Oluwatimileyin", ... }
```

**Verify response headers locally:**

```bash
curl -I http://127.0.0.1:3000/health
# HTTP/1.1 200 OK
# Content-Type: application/json; charset=utf-8
```

---

## Deployment Process

The deployment is layered intentionally. Each layer is added in sequence and tested independently before the next is introduced.

### 1. Application Files

```bash
# On the server — copy application files
sudo mkdir -p /var/www/minimal-api
sudo cp app.js package.json /var/www/minimal-api/
sudo chown -R nodeuser:nodeuser /var/www/minimal-api

# Install production dependencies only
cd /var/www/minimal-api
sudo -u nodeuser npm install --omit=dev
```

At this point, the app can be started manually and tested from the server itself:

```bash
node /var/www/minimal-api/app.js &
curl http://127.0.0.1:3000/health   # should return {"message":"healthy"}
kill %1
```

The app must not be reachable on its port from outside the server at this stage — that is the expected and correct behavior.

---

### 2. systemd Service

The systemd unit file ensures the process starts on boot, runs as a non-root user, and restarts automatically on failure.

**`/etc/systemd/system/minimal-api.service`:**

```ini
[Unit]
Description=Minimal Node.js API
After=network.target

[Service]
Type=simple
User=nodeuser
Group=nodeuser
WorkingDirectory=/var/www/minimal-api
ExecStart=/usr/bin/node app.js
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=3
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
SyslogIdentifier=minimal-api
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable minimal-api   # register for auto-start on boot
sudo systemctl start minimal-api

# Verify
sudo systemctl status minimal-api
sudo journalctl -u minimal-api -f
```

**How systemd ensures uptime:**
- `Restart=on-failure` triggers an automatic restart whenever the process exits with a non-zero code (crash, OOM kill, unhandled exception)
- `RestartSec=5s` introduces a backoff delay to avoid a crash loop consuming resources
- `StartLimitBurst=3` — if the process fails 3 times within 60 seconds, systemd marks the unit as `failed` and stops restarting, surfacing the hard failure for operator investigation rather than silently thrashing
- `After=network.target` prevents startup race conditions where Node attempts to bind a socket before the network interface is ready

---

### 3. Nginx Reverse Proxy

**`/etc/nginx/sites-available/minimal-api`:**

```nginx
# Redirect all HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name api.mosesekerin.name.ng;
    return 301 https://$host$request_uri;
}

# HTTPS server — proxies to Node.js
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name api.mosesekerin.name.ng;

    ssl_certificate     /etc/letsencrypt/live/api.mosesekerin.name.ng/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.mosesekerin.name.ng/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;

    location / {
        proxy_pass          http://127.0.0.1:3000;
        proxy_set_header    Host              $host;
        proxy_set_header    X-Real-IP         $remote_addr;
        proxy_set_header    X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout    10s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/minimal-api /etc/nginx/sites-enabled/
sudo nginx -t          # validate config before applying
sudo systemctl reload nginx
```

**How Nginx routes requests internally:**
Every request arriving on port 443 is TLS-decrypted by Nginx, then forwarded as plain HTTP to `127.0.0.1:3000`. The Node process receives a standard HTTP request — it never handles raw TLS, never sees the public-facing socket. The `proxy_set_header` directives reconstruct the original request context so the application can log the real client IP and protocol.

---

## Request Flow

A request to `GET /me` travels through the following stages:

1. **DNS Resolution** — The client resolves `api.mosesekerin.name.ng` to the server's public IP via the domain's A record.

2. **Firewall Entry** — The OS firewall (ufw) accepts connections on port 443. Port 3000 has no firewall rule and is not publicly reachable.

3. **TLS Handshake (Nginx)** — Nginx terminates the TLS connection using the Let's Encrypt certificate. The encrypted transport layer is handled entirely here; the Node process is not involved.

4. **Reverse Proxy (Nginx)** — Nginx matches the request path against `location /`, injects the `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers, then opens a connection to `127.0.0.1:3000` and forwards the request.

5. **Route Handling (Express)** — Express matches `GET /me`, constructs the JSON response object, and calls `res.status(200).json({...})`, which sets the status line and `Content-Type: application/json` header automatically.

6. **Response Return** — The JSON payload travels back through the Nginx proxy connection. Nginx appends configured security headers (`HSTS`, etc.) and returns the response to the client over the existing TLS session.

---

## Failure Scenarios

### Backend process crashes

systemd detects the non-zero exit and schedules a restart after 5 seconds. During that window, Nginx receives `connection refused` on `127.0.0.1:3000` and returns `502 Bad Gateway` to the client. Once the process restarts, traffic resumes transparently — no Nginx restart required. If the process crashes 3 times within 60 seconds, systemd stops retrying; `502` becomes persistent until a human investigates.

```bash
# Observe the restart cycle
sudo journalctl -u minimal-api -f
# → process exit logged → 5s pause → "Started Minimal Node.js API"
```

### Nginx stops

Port 443 stops accepting connections. Clients receive a TCP-level connection refused — there is no HTTP response at all (`curl: (7) Failed to connect`). The Node process continues running on `127.0.0.1:3000` and is unaffected. The application layer is healthy; only the ingress is unavailable. Restarting Nginx restores public access immediately.

```bash
sudo systemctl start nginx
```

### Port 3000 exposed to the public network

If the application were bound to `0.0.0.0:3000` or a firewall rule opened port 3000, the Node server would be directly reachable from the internet. This breaks the security model in several ways: there is no TLS on that connection (traffic is plaintext), the security headers added by Nginx are absent, and the Node process is exposed to direct load without the rate limiting Nginx provides. This is prevented by design — the app binds to `127.0.0.1` and the firewall has no rule for port 3000.

---

## Performance

All three endpoints meet the `< 500ms` response time requirement. This is a direct result of the architecture, not tuning:

- **No I/O on the hot path** — no database queries, no external API calls, no disk reads. All responses are constructed from in-memory values.
- **No middleware overhead** — the Express app has no body parser, session handler, or authentication layer. Each request goes directly from router to response.
- **Nginx keep-alive** — persistent connections between Nginx and clients eliminate repeated TCP handshake overhead for sequential requests.
- **TLS session resumption** — Let's Encrypt with Nginx supports TLS session tickets, reducing handshake latency on repeat visits.

For a stateless in-memory API of this type, response time is bounded by network RTT, not application logic. On the same datacenter network, responses are typically sub-10ms.

---

## Live URL

**`https://api.mosesekerin.name.ng`**

```bash
# Quick validation
curl -s https://api.mosesekerin.name.ng/       | python3 -m json.tool
curl -s https://api.mosesekerin.name.ng/health | python3 -m json.tool
curl -s https://api.mosesekerin.name.ng/me     | python3 -m json.tool

# Verify HTTP redirect
curl -I http://api.mosesekerin.name.ng/
# HTTP/1.1 301 Moved Permanently
# Location: https://api.mosesekerin.name.ng/

# Verify TLS and response headers
curl -sI https://api.mosesekerin.name.ng/health
# HTTP/2 200
# content-type: application/json; charset=utf-8
# strict-transport-security: max-age=63072000; includeSubDomains
```

---

## Author

**Ekerin Oluwatimileyin**
[mosesekerin@gmail.com](mailto:mosesekerin@gmail.com) · [github.com/mosesekerin](https://github.com/mosesekerin)
