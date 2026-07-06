"""
SnapSki sync hub — tiny FastAPI + SQLite + flat files.

One person == one "sync group" (their own devices). No accounts/passwords:
the group is identified by a UUID `group_id` plus a 32-byte random `token`.
The server only ever stores the SHA-256 hash of the token; clients prove
themselves with `Authorization: Bearer <group_id>:<token>` on every request.

Shots are immutable (id + png + meta). Favorite/delete are ops in an append-only
event log; conflicts resolve last-write-wins by the client timestamp `ts`.
Every shot and op gets a monotonic server `seq` (SQLite AUTOINCREMENT); clients
remember the last `seq` they saw and poll `GET /changes?since=<seq>`.

Deploy: see README.md. Runs standalone from firefly — own venv, own systemd unit.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

DATA_DIR = Path(os.environ.get("SNAPSKI_HUB_DATA", "./data")).resolve()
DB_PATH = DATA_DIR / "hub.sqlite3"
FILES_DIR = DATA_DIR / "files"

# 2 GB per group; refuse (507) rather than silently evicting.
GROUP_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
CHANGES_LIMIT = 200
MAX_UPLOAD_BYTES = 40 * 1024 * 1024  # a single PNG shot; sanity ceiling

app = FastAPI(title="SnapSki Hub", version="1.0")


# --------------------------------------------------------------------------- db
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS groups (
                group_id   TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shots (
                group_id   TEXT NOT NULL,
                shot_id    TEXT NOT NULL,
                meta       TEXT NOT NULL,   -- JSON: createdAt, favorite, source, editedFrom
                size       INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (group_id, shot_id)
            );

            CREATE TABLE IF NOT EXISTS events (
                seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id   TEXT NOT NULL,
                kind       TEXT NOT NULL,   -- shot | favorite | delete
                shot_id    TEXT NOT NULL,
                value      INTEGER,         -- favorite: 0/1
                ts         INTEGER,         -- client timestamp (LWW)
                meta       TEXT,            -- JSON for shot events
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_group_seq ON events(group_id, seq);
            """
        )


@app.on_event("startup")
def _startup() -> None:
    init_db()


# ------------------------------------------------------------------------- auth
def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def require_group(authorization: Optional[str] = Header(None)) -> str:
    """Validate `Authorization: Bearer <group_id>:<token>` and return group_id."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    cred = authorization[7:].strip()
    group_id, _, token = cred.partition(":")
    if not group_id or not token:
        raise HTTPException(401, "malformed credential")
    with db() as conn:
        row = conn.execute(
            "SELECT token_hash FROM groups WHERE group_id = ?", (group_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(401, "unknown group")
    # constant-time-ish compare
    if not _consteq(row["token_hash"], sha256_hex(token)):
        raise HTTPException(401, "bad token")
    return group_id


def _consteq(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    r = 0
    for x, y in zip(a, b):
        r |= ord(x) ^ ord(y)
    return r == 0


def group_usage(conn: sqlite3.Connection, group_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(size), 0) AS used FROM shots WHERE group_id = ?",
        (group_id,),
    ).fetchone()
    return int(row["used"])


# --------------------------------------------------------------------- endpoints
@app.get("/health")
def health():
    return {"ok": True, "ts": int(time.time())}


@app.post("/register")
async def register(request: Request):
    """First-come, idempotent group registration.

    Body: {"group_id": "<uuid>", "token_hash": "<sha256 hex of token>"}.
    Re-registering with the same hash is a no-op; a different hash is 409.
    """
    body = await request.json()
    group_id = (body or {}).get("group_id", "").strip()
    token_hash = (body or {}).get("token_hash", "").strip().lower()
    if not group_id or len(token_hash) != 64:
        raise HTTPException(400, "group_id and 64-hex token_hash required")
    now = int(time.time())
    with db() as conn:
        existing = conn.execute(
            "SELECT token_hash FROM groups WHERE group_id = ?", (group_id,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO groups(group_id, token_hash, created_at) VALUES (?,?,?)",
                (group_id, token_hash, now),
            )
            return {"group_id": group_id, "created": True}
        if not _consteq(existing["token_hash"], token_hash):
            raise HTTPException(409, "group_id already registered with a different token")
        return {"group_id": group_id, "created": False}


@app.post("/shots")
async def upload_shot(
    meta: str = Form(...),
    file: UploadFile = ...,
    group_id: str = Depends(require_group),
):
    """Upload one immutable shot. Multipart: meta JSON + PNG.

    Dedup by client shot id: re-uploading an existing id returns its seq without
    creating a new event. Returns {seq, shot_id, deduped}.
    """
    try:
        m = json.loads(meta)
    except json.JSONDecodeError:
        raise HTTPException(400, "meta must be JSON")
    shot_id = str(m.get("id", "")).strip()
    if not shot_id:
        raise HTTPException(400, "meta.id required")

    with db() as conn:
        existing = conn.execute(
            "SELECT shot_id FROM shots WHERE group_id = ? AND shot_id = ?",
            (group_id, shot_id),
        ).fetchone()
        if existing is not None:
            seq = conn.execute(
                "SELECT MAX(seq) AS s FROM events "
                "WHERE group_id = ? AND kind = 'shot' AND shot_id = ?",
                (group_id, shot_id),
            ).fetchone()["s"]
            return {"seq": seq, "shot_id": shot_id, "deduped": True}

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")

    with db() as conn:
        used = group_usage(conn, group_id)
        if used + len(data) > GROUP_QUOTA_BYTES:
            raise HTTPException(507, "sync storage full for this group")

        gdir = FILES_DIR / group_id
        gdir.mkdir(parents=True, exist_ok=True)
        # store under a sanitized id to keep files inside the group dir
        safe_id = shot_id.replace("/", "_").replace("\\", "_").replace("..", "_")
        (gdir / f"{safe_id}.png").write_bytes(data)

        now = int(time.time())
        meta_clean = json.dumps(
            {
                "id": shot_id,
                "createdAt": m.get("createdAt"),
                "favorite": bool(m.get("favorite", False)),
                "source": m.get("source", "import"),
                "editedFrom": m.get("editedFrom"),
            }
        )
        conn.execute(
            "INSERT INTO shots(group_id, shot_id, meta, size, created_at) "
            "VALUES (?,?,?,?,?)",
            (group_id, shot_id, meta_clean, len(data), now),
        )
        cur = conn.execute(
            "INSERT INTO events(group_id, kind, shot_id, value, ts, meta, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (group_id, "shot", shot_id, None, m.get("createdAt"), meta_clean, now),
        )
        return {"seq": cur.lastrowid, "shot_id": shot_id, "deduped": False}


@app.post("/ops")
async def post_op(request: Request, group_id: str = Depends(require_group)):
    """Record a favorite/delete op. Body: {kind, shot_id, value?, ts}.

    delete also removes the stored file (id/meta row stays absent; the event
    persists so other devices learn about it). Returns {seq}.
    """
    body = await request.json()
    kind = (body or {}).get("kind", "")
    shot_id = str((body or {}).get("shot_id", "")).strip()
    ts = (body or {}).get("ts") or int(time.time() * 1000)
    if kind not in ("favorite", "delete") or not shot_id:
        raise HTTPException(400, "kind in {favorite,delete} and shot_id required")

    value = None
    if kind == "favorite":
        value = 1 if (body or {}).get("value", True) else 0

    now = int(time.time())
    with db() as conn:
        if kind == "favorite":
            conn.execute(
                "UPDATE shots SET meta = json_set(meta, '$.favorite', ?) "
                "WHERE group_id = ? AND shot_id = ?",
                (bool(value), group_id, shot_id),
            )
        elif kind == "delete":
            row = conn.execute(
                "SELECT 1 FROM shots WHERE group_id = ? AND shot_id = ?",
                (group_id, shot_id),
            ).fetchone()
            if row is not None:
                conn.execute(
                    "DELETE FROM shots WHERE group_id = ? AND shot_id = ?",
                    (group_id, shot_id),
                )
                safe_id = shot_id.replace("/", "_").replace("\\", "_").replace("..", "_")
                fp = FILES_DIR / group_id / f"{safe_id}.png"
                if fp.exists():
                    fp.unlink()
        cur = conn.execute(
            "INSERT INTO events(group_id, kind, shot_id, value, ts, meta, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (group_id, kind, shot_id, value, ts, None, now),
        )
        return {"seq": cur.lastrowid}


@app.get("/changes")
def changes(since: int = 0, group_id: str = Depends(require_group)):
    """Events with seq > since for this group, oldest first, capped at 200.

    Each shot event carries its meta; favorite/delete carry value. Binaries are
    fetched separately via /shots/{id}/file. `next` is the highest seq returned
    (== since when there's nothing new).
    """
    with db() as conn:
        rows = conn.execute(
            "SELECT seq, kind, shot_id, value, ts, meta FROM events "
            "WHERE group_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
            (group_id, since, CHANGES_LIMIT),
        ).fetchall()
        used = group_usage(conn, group_id)

    items = []
    for r in rows:
        item = {"seq": r["seq"], "kind": r["kind"], "shot_id": r["shot_id"]}
        if r["kind"] == "shot" and r["meta"]:
            item["meta"] = json.loads(r["meta"])
        if r["kind"] == "favorite":
            item["value"] = bool(r["value"])
        if r["ts"] is not None:
            item["ts"] = r["ts"]
        items.append(item)

    next_seq = items[-1]["seq"] if items else since
    return {
        "changes": items,
        "next": next_seq,
        "has_more": len(items) == CHANGES_LIMIT,
        "usage": used,
        "quota": GROUP_QUOTA_BYTES,
    }


@app.get("/shots/{shot_id}/file")
def shot_file(shot_id: str, group_id: str = Depends(require_group)):
    safe_id = shot_id.replace("/", "_").replace("\\", "_").replace("..", "_")
    fp = FILES_DIR / group_id / f"{safe_id}.png"
    if not fp.exists():
        raise HTTPException(404, "shot not found")
    return FileResponse(fp, media_type="image/png")


@app.exception_handler(HTTPException)
def http_exc(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
