# SnapSki Hub

Tiny sync server for SnapSki: one person's devices share a screenshot library
through this. FastAPI + SQLite + flat PNG files. Stands alone from firefly —
own venv, own systemd unit, own Caddy route.

See `../PLAN_SYNC.md` for the model. Server stores only the **hash** of each
group's token; clients authenticate with `Authorization: Bearer <group_id>:<token>`.

## Endpoints

| Method | Path                  | Auth  | Notes |
|--------|-----------------------|-------|-------|
| GET    | `/health`             | no    | liveness |
| POST   | `/register`           | no    | `{group_id, token_hash}`; first-come, idempotent (409 on hash mismatch) |
| POST   | `/shots`              | yes   | multipart `meta` (JSON) + `file` (PNG); dedup by id; 507 over quota |
| POST   | `/ops`                | yes   | `{kind: favorite\|delete, shot_id, value?, ts}` |
| GET    | `/changes?since=<seq>`| yes   | events with `seq > since`, ≤200, oldest first; `next` = new cursor |
| GET    | `/shots/{id}/file`    | yes   | PNG bytes |

Quota: 2 GB per group → `507` (client shows "sync storage full"). No auto-evict.

## Run locally

```bash
cd hub
python -m venv venv && source venv/bin/activate   # win: venv/Scripts/activate
pip install -r requirements.txt
SNAPSKI_HUB_DATA=./data uvicorn app:app --host 127.0.0.1 --port 8790
```

## Curl smoke test

```bash
BASE=http://127.0.0.1:8790
GID=$(python -c "import uuid;print(uuid.uuid4())")
TOK=$(python -c "import secrets,base64;print(base64.b64encode(secrets.token_bytes(32)).decode())")
TH=$(printf %s "$TOK" | sha256sum | cut -d' ' -f1)
AUTH="Authorization: Bearer $GID:$TOK"

curl -s "$BASE/health"
curl -s -X POST "$BASE/register" -H 'Content-Type: application/json' \
     -d "{\"group_id\":\"$GID\",\"token_hash\":\"$TH\"}"

# upload a shot
printf 'PNGDATA' > /tmp/a.png
curl -s -X POST "$BASE/shots" -H "$AUTH" \
     -F 'meta={"id":"abc123","createdAt":1720000000000,"source":"capture"};type=application/json' \
     -F 'file=@/tmp/a.png;type=image/png'

curl -s "$BASE/changes?since=0" -H "$AUTH"
curl -s "$BASE/shots/abc123/file" -H "$AUTH" --output /tmp/back.png && cat /tmp/back.png
curl -s -X POST "$BASE/ops" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"kind":"favorite","shot_id":"abc123","value":true,"ts":1720000001000}'
curl -s "$BASE/changes?since=0" -H "$AUTH"
```

## Deploy on Oracle VM

Repo is already the PRIVATE monorepo. On the VM:

```bash
cd ~/snapski && git pull --ff-only
cd hub
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
mkdir -p data

# systemd (user or system unit — this ships a system-style unit running as ubuntu)
sudo cp snapski-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now snapski-hub
systemctl status snapski-hub --no-pager

# Caddy: paste Caddyfile.snippet into the chat.wishly.wtf block, then
sudo systemctl reload caddy
curl -s https://chat.wishly.wtf/snapski-hub/health
```

Data lives in `data/` (gitignored): `hub.sqlite3` + `files/{group_id}/{shot_id}.png`.
