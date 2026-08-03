# Local development: run the full real-data stack

This runs a real Solace PubSub+ broker locally and feeds it **real** satellite
telemetry (Celestrak TLEs propagated with SGP4 by the Go `orbital-emitter`), so
the web app renders genuine live orbital positions — no mock feed.

Pipeline:

```
orbital-emitter (Go, SGP4)  --SMF/tcp 55555-->  Solace broker  <--WebSocket 8008--  web app (browser)
```

## Prerequisites

- Docker (Colima works on macOS ARM).
- Node 20+ for the web app.

## 1. Start the Solace broker

The broker **requires** a raised `nofile` ulimit or it fails its POST checks and
exits. It also needs shared memory.

```bash
docker run -d --name solace-orbital \
  --shm-size=1g \
  --ulimit core=-1 \
  --ulimit nofile=2448:1048576 \
  -p 8008:8008 \
  -p 55555:55555 \
  -p 8080:8080 \
  solace/solace-pubsub-standard:latest
```

Ports:
- **8008** – Web Messaging (WebSocket) — the browser connects here.
- **55555** – SMF (TCP) — the Go emitter publishes here.
- **8080** – SEMP admin / web UI (`admin` / `admin`).

Wait until the broker is active. The "ready" line lands in the broker's
**internal** log, not `docker logs`:

```bash
docker exec solace-orbital \
  grep -m1 "Primary Virtual Router is now active" /usr/sw/jail/logs/system.log
# or: docker exec solace-orbital tail /usr/sw/jail/logs/system.log
```

Default VPN/credentials: `default` / `default` / `default`.

## 2. Start the orbital emitter (real telemetry)

Build the image and run it **on the broker's Docker network** so it reaches the
broker container-to-container. (Colima's host→VM forwarding for non-HTTP ports
such as 55555 is unreliable; container→container needs no host forward.)

```bash
# From repo root
docker build -t orbital-mesh/emitter:local services/orbital-emitter

# Find the broker's bridge IP (usually 172.17.0.2)
BROKER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' solace-orbital)

docker run -d --name orbital-emitter-local \
  -e SOLACE_HOST="tcp://${BROKER_IP}:55555" \
  -e SOLACE_VPN=default \
  -e SOLACE_USERNAME=default \
  -e SOLACE_PASSWORD=default \
  orbital-mesh/emitter:local
```

The emitter fetches the Celestrak `ACTIVE` group, propagates every satellite
with SGP4, and publishes one message per satellite every second to:

```
earth/sat/tracked/{orbit}/{provider}/{noradId}/{latCell}/{lngCell}
```

Payload: `{lat,lng,alt,name,id,launchYear,inc,ecc}`.

## 3. Point the web app at the local broker

Create `web/.env` (gitignored):

```
VITE_SOLACE_URL=ws://localhost:8008
VITE_SOLACE_VPN=default
VITE_SOLACE_USER=default
VITE_SOLACE_PASS=default
```

Then start the dev server (Vite reads `.env` only at startup — restart after edits):

```bash
cd web
npm install
npm run dev
# open the printed URL, e.g. http://localhost:5173/orbital-mesh/
```

You should see hundreds of satellites, a live message rate, and real providers
(starlink, oneweb, gps, iss, …) in the event stream.

## Verify the broker is receiving data

```bash
# Client / message counts via SEMP
curl -s -u admin:admin \
  http://localhost:8080/SEMP/v2/monitor/msgVpns/default/clients | \
  grep -o '"clientName":"[^"]*"'
```

## Tear down

```bash
docker rm -f orbital-emitter-local solace-orbital
```
