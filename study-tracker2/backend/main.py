from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, date, timedelta
from typing import Optional
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
import os
import json
import threading
import time
import urllib.request
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("study-tracker")

JST = ZoneInfo("Asia/Tokyo")

from database import get_db, init_db
from models import *
from logic import calculate_next_srs, calc_daily_quota

MY_USER_ID = os.getenv("SLACK_MENTION_USER_ID", "").strip()

def db_conn():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    import threading
    t = threading.Thread(target=_notifier_loop, daemon=True)
    t.start()
    log.info("Background notifier thread started")
    yield

app = FastAPI(lifespan=lifespan)

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "").strip()
SLACK_NOTIFIER_THREAD = None

# Serve static files
# Make sure frontend/static exists
app.mount("/static", StaticFiles(directory="/app/frontend/static"), name="static")

def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}

def _slack_notifier_enabled() -> bool:
    flag = os.getenv("SLACK_NOTIFY_ENABLED", "").strip()
    if flag:
        return _is_truthy(flag)
    return bool(SLACK_WEBHOOK_URL)

def _collect_today_subject_progress(conn):
    rows = conn.execute("""
        SELECT s.id, s.name, s.category, w.deadline
        FROM subjects s
        LEFT JOIN workbooks w ON w.subject_id = s.id
        WHERE s.is_paused = 0
        ORDER BY s.category, s.name, s.id
    """).fetchall()
    items = []
    for row in rows:
        quota = calc_daily_quota(conn, row["id"], row["deadline"] if row["deadline"] else None, exclude_today=True)
        done = int(quota.get("today_done", 0) or 0)
        total = int(quota.get("today_total", 0) or 0)
        pct = 100 if total == 0 else round(done / total * 100)
        items.append({
            "id": row["id"],
            "name": row["name"],
            "done": done,
            "total": total,
            "pct": pct,
        })
    return items

def _build_slack_today_message(now_dt: datetime, items) -> str:
    header = f"📚 今日タブ進捗 ({now_dt.strftime('%Y-%m-%d %H:%M')})"
    # 自分宛にメンションを飛ばす（これでスマホに通知が来やすくなる）
    mention = f"<@{MY_USER_ID}> " if MY_USER_ID else ""
    if not items:
        return f"{mention}{header}\n題材がありません。"
    total_done = sum(x["done"] for x in items)
    total_total = sum(x["total"] for x in items)
    total_pct = 100 if total_total == 0 else round(total_done / total_total * 100)
    lines = [f"{mention}{header}", f"合計: {total_done} / {total_total} ({total_pct}%)"]
    lines.extend([f"・{x['name']}: {x['done']} / {x['total']} ({x['pct']}%)" for x in items])
    return "\n".join(lines)

def _post_to_slack(message: str):
    payload = json.dumps({"text": message}).encode("utf-8")
    req = urllib.request.Request(
        SLACK_WEBHOOK_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()

def send_today_progress_to_slack():
    if not SLACK_WEBHOOK_URL:
        raise RuntimeError("SLACK_WEBHOOK_URL is not set")
    conn = get_db()
    try:
        items = _collect_today_subject_progress(conn)
    finally:
        conn.close()
    message = _build_slack_today_message(datetime.now(JST), items)
    _post_to_slack(message)
    return {"sent": True, "subject_count": len(items)}

def _seconds_until_next_hour(now_dt: datetime = None) -> int:
    now_dt = now_dt or datetime.now(JST)
    next_dt = (now_dt + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    return max(1, int((next_dt - now_dt).total_seconds()))

def _notifier_loop():
    while True:
        # 次の正時まで待機
        time.sleep(_seconds_until_next_hour())
        try:
            now = datetime.now(JST)
            # Slack: 7:00から20:00の間のみ送信
            if _slack_notifier_enabled() and 7 <= now.hour <= 20:
                send_today_progress_to_slack()
            
            # Blinko: 7:00, 13:00, 19:00 に送信
            if now.hour in {7, 21}:
                from blinko_sync import collect_summary, send_to_blinko
                summary = collect_summary()
                send_to_blinko(summary)
                print(f"Automated Blinko sync at {now.hour}:00")

        except Exception as e:
            print(f"Notifier loop failed: {e}")

def verify_admin(x_admin_token: str = Header(default="")):
    expected = os.getenv("ADMIN_TOKEN", "").strip()
    if expected and x_admin_token != expected:
        raise HTTPException(401, "unauthorized")
    if not expected:
        log.warning("ADMIN_TOKEN unset — admin endpoint is open")

# ── Subjects ──────────────────────────────────────────────────
@app.get("/api/subjects")
def list_subjects():
    conn = get_db()
    rows = conn.execute("""
        SELECT 
            s.*, w.deadline,
            (SELECT COUNT(*) FROM problems p WHERE p.subject_id = s.id) as total,
            (SELECT COUNT(DISTINCT p.id) FROM problems p JOIN records r ON r.problem_id = p.id 
             WHERE p.subject_id = s.id AND r.result = 'o') as mastered,
            (SELECT COUNT(*) FROM problems p WHERE p.subject_id = s.id AND p.pass2_date IS NOT NULL) as pass2_done
        FROM subjects s
        LEFT JOIN workbooks w ON w.subject_id = s.id
        ORDER BY s.category, s.name, s.id
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/subjects")
def create_subject(data: SubjectCreate):
    conn = get_db()
    now = datetime.now(JST).isoformat()
    cur = conn.cursor()
    cur.execute("INSERT INTO subjects (name, category, type_tag, created_at) VALUES (?,?,?,?)",
                (data.name, data.category, data.type_tag, now))
    sid = cur.lastrowid
    for i, p in enumerate(data.problems):
        cur.execute("INSERT INTO problems (subject_id, label, group_label, sort_order) VALUES (?,?,?,?)",
                    (sid, p.get("label",""), p.get("group_label",""), i))
    if data.deadline:
        cur.execute("INSERT OR REPLACE INTO workbooks (subject_id, deadline) VALUES (?,?)", (sid, data.deadline))
    conn.commit()
    conn.close()
    return {"id": sid}

@app.patch("/api/subjects/{sid}")
def update_subject(sid: int, data: SubjectUpdate):
    conn = get_db()
    if data.name is not None: conn.execute("UPDATE subjects SET name=? WHERE id=?", (data.name, sid))
    if data.category is not None: conn.execute("UPDATE subjects SET category=? WHERE id=?", (data.category, sid))
    if data.type_tag is not None: conn.execute("UPDATE subjects SET type_tag=? WHERE id=?", (data.type_tag, sid))
    if data.is_paused is not None:
        conn.execute("UPDATE subjects SET is_paused=? WHERE id=?", (data.is_paused, sid))
        if data.is_paused == 1:
            conn.execute("DELETE FROM workbooks WHERE subject_id=?", (sid,))
    if data.deadline is not None:
        if data.deadline == "": conn.execute("DELETE FROM workbooks WHERE subject_id=?", (sid,))
        else: conn.execute("INSERT OR REPLACE INTO workbooks (subject_id, deadline) VALUES (?,?)", (sid, data.deadline))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/subjects/{sid}")
def delete_subject(sid: int):
    conn = get_db()
    pids = [r[0] for r in conn.execute("SELECT id FROM problems WHERE subject_id=?", (sid,)).fetchall()]
    if pids:
        ph = ','.join(['?']*len(pids))
        conn.execute(f"DELETE FROM srs_items WHERE problem_id IN ({ph})", pids)
        conn.execute(f"DELETE FROM records WHERE problem_id IN ({ph})", pids)
    conn.execute("DELETE FROM problems WHERE subject_id=?", (sid,))
    conn.execute("DELETE FROM workbooks WHERE subject_id=?", (sid,))
    conn.execute("DELETE FROM subjects WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/subjects/{sid}/progress")
def get_subject_progress(sid: int):
    conn = get_db()
    row = conn.execute("""
        SELECT 
            (SELECT COUNT(*) FROM problems WHERE subject_id = ?) as total,
            (SELECT COUNT(DISTINCT p.id) FROM problems p JOIN records r ON r.problem_id = p.id 
             WHERE p.subject_id = ? AND r.result = 'o') as mastered,
            (SELECT COUNT(*) FROM problems WHERE subject_id = ? AND pass2_date IS NOT NULL) as pass2_done
    """, (sid, sid, sid)).fetchone()
    conn.close()
    return {"total": row["total"], "mastered": row["mastered"], "pass2_done": row["pass2_done"]}

# ── Problems ──────────────────────────────────────────────────
@app.get("/api/subjects/{sid}/problems")
def list_problems(sid: int):
    conn = get_db()
    probs = conn.execute(
        "SELECT * FROM problems WHERE subject_id=? ORDER BY sort_order, LENGTH(label), label, id", (sid,)
    ).fetchall()
    result = []
    for p in probs:
        recs = conn.execute("SELECT attempt, result, recorded_at FROM records WHERE problem_id=? ORDER BY attempt", (p["id"],)).fetchall()
        rec_map = {r["attempt"]: {"result": r["result"], "recorded_at": r["recorded_at"]} for r in recs}
        srs = conn.execute("SELECT due_date, stability FROM srs_items WHERE problem_id=?", (p["id"],)).fetchone()
        result.append({
            "id": p["id"], "label": p["label"], "group_label": p["group_label"], "status": p["status"] or 0,
            "pass1_date": p["pass1_date"], "pass2_date": p["pass2_date"], "records": rec_map,
            "srs_due": srs["due_date"] if srs else None, "srs_stability": srs["stability"] if srs else None,
        })
    conn.close()
    return result

@app.get("/api/subjects/{sid}/quota")
def get_subject_quota(sid: int):
    conn = get_db()
    wb = conn.execute("SELECT deadline FROM workbooks WHERE subject_id=?", (sid,)).fetchone()
    # 締切がなくても進捗（復習分など）を計算できるようにする
    res = calc_daily_quota(conn, sid, wb["deadline"] if wb else None, exclude_today=True)
    conn.close()
    return res

@app.post("/api/problems/{pid}/record/{attempt}")
def update_record(pid: int, attempt: int, data: RecordUpdate):
    conn = get_db()
    today = datetime.now(JST).date()
    now_dt = datetime.now(JST)
    row = conn.execute("SELECT subject_id FROM problems WHERE id=?", (pid,)).fetchone()
    if not row:
        raise HTTPException(404, "Problem not found")
    sid = row[0]
    conn.execute("""
        INSERT INTO records (problem_id, attempt, result, recorded_at) VALUES (?,?,?,?)
        ON CONFLICT(problem_id, attempt) DO UPDATE SET result=excluded.result, recorded_at=excluded.recorded_at
    """, (pid, attempt, data.result, now_dt.isoformat()))
    if data.result:
        conn.execute("INSERT INTO activity_log (problem_id, subject_id, action_type, result, timestamp) VALUES (?, ?, ?, ?, ?)",
                     (pid, sid, 'record', data.result, now_dt.isoformat()))
    if data.result == 'x':
        exists = conn.execute("SELECT stability, difficulty FROM srs_items WHERE problem_id=?", (pid,)).fetchone()
        if not exists:
            conn.execute("INSERT INTO srs_items (problem_id, stability, difficulty, due_date, last_review, reps, lapses, state) VALUES (?, 0.4, 5.0, ?, ?, 1, 1, 1)",
                         (pid, today.isoformat(), now_dt.isoformat()))
        else:
            s, d = calculate_next_srs(1, exists["stability"], exists["difficulty"])
            conn.execute("UPDATE srs_items SET stability=?, difficulty=?, due_date=?, last_review=?, reps=reps+1, lapses=lapses+1, state=1 WHERE problem_id=?",
                         (s, d, (today + timedelta(days=max(0,round(s)))).isoformat(), now_dt.isoformat(), pid))
    elif data.result == 'o':
        conn.execute("DELETE FROM srs_items WHERE problem_id = ?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True, "recorded_at": now_dt.isoformat()}

@app.patch("/api/problems/{pid}/status")
def patch_problem_status(pid: int, data: ProblemStatusUpdate):
    conn = get_db()
    today = datetime.now(JST).date().isoformat()
    if data.status == 1:
        conn.execute("UPDATE problems SET status=?, pass1_date=? WHERE id=?", (data.status, today, pid))
    elif data.status == 2:
        conn.execute("UPDATE problems SET status=?, pass2_date=? WHERE id=?", (data.status, today, pid))
    else:
        conn.execute("UPDATE problems SET status=?, pass1_date=NULL, pass2_date=NULL WHERE id=?", (data.status, pid))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── SRS ───────────────────────────────────────────────────────
@app.get("/api/srs/queue")
def srs_queue():
    today = datetime.now(JST).date().isoformat()
    conn = get_db()
    # ソート順: state=1 (今日「忘れた」もの) を後に、それ以外(state=0,2)を前に。
    # その中で問題番号(sort_order)の昇順
    rows = conn.execute("""
        SELECT si.*, p.label, p.sort_order, s.name as subject_name, s.id as subject_id
        FROM srs_items si
        JOIN problems p ON p.id = si.problem_id
        JOIN subjects s ON s.id = p.subject_id
        WHERE (si.due_date <= ? 
        OR (si.last_review LIKE ? AND si.state = 1))
        AND s.is_paused = 0
        ORDER BY 
            CASE WHEN si.last_review LIKE ? AND si.state = 1 THEN 1 ELSE 0 END ASC, 
            p.sort_order ASC, 
            LENGTH(p.label) ASC, 
            p.label ASC,
            si.due_date ASC
    """, (today, f"{today}%", f"{today}%")).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/srs/review")
def review_srs(data: SRSReview):
    conn = get_db()
    today = datetime.now(JST).date()
    now_dt = datetime.now(JST)
    item = conn.execute("SELECT si.*, p.subject_id FROM srs_items si JOIN problems p ON p.id = si.problem_id WHERE si.problem_id=?", (data.problem_id,)).fetchone()
    if not item:
        conn.close()
        raise HTTPException(404, "SRS not found")
    
    s, d = calculate_next_srs(data.rating, item["stability"], item["difficulty"])
    interval = max(1, round(s))
    due = today + timedelta(days=interval)
    
    conn.execute("UPDATE srs_items SET stability=?, difficulty=?, due_date=?, last_review=?, reps=(COALESCE(reps,0)+1), lapses=?, state=? WHERE problem_id=?",
                 (s, d, due.isoformat(), now_dt.isoformat(), (item["lapses"] or 0) + (1 if data.rating == 1 else 0), 1 if data.rating == 1 else 2, data.problem_id))
    
    # recordsテーブルにも反映（直近の空きスロットに入れる）
    last_att_row = conn.execute("SELECT MAX(attempt) FROM records WHERE problem_id=?", (data.problem_id,)).fetchone()
    last_att = last_att_row[0] if last_att_row and last_att_row[0] is not None else 0
    next_att = min(5, last_att + 1)
    res_sym = 'o' if data.rating >= 2 else 'x'
    
    conn.execute("""
        INSERT INTO records (problem_id, attempt, result, recorded_at) VALUES (?,?,?,?)
        ON CONFLICT(problem_id, attempt) DO UPDATE SET result=excluded.result, recorded_at=excluded.recorded_at
    """, (data.problem_id, next_att, res_sym, now_dt.isoformat()))

    conn.execute("INSERT INTO activity_log (problem_id, subject_id, action_type, result, timestamp) VALUES (?, ?, ?, ?, ?)",
                 (data.problem_id, item["subject_id"], 'srs', str(data.rating), now_dt.isoformat()))
    conn.commit()
    conn.close()
    return {"ok": True, "interval": interval}

# ── Stats ─────────────────────────────────────────────────────
@app.get("/api/stats/today")
def today_stats():
    today = datetime.now(JST).date().isoformat()
    conn = get_db()
    try:
        # 停止中でない題材のみを対象とする
        subjects = conn.execute("SELECT id FROM subjects WHERE is_paused = 0").fetchall()
        total_quota = 0
        for s in subjects:
            wb = conn.execute("SELECT deadline FROM workbooks WHERE subject_id=?", (s["id"],)).fetchone()
            if wb and wb["deadline"]:
                # 使用するquotaは、今日が始まる時点での残りタスク数に基づくべき（進捗バーが動くように）
                quota_info = calc_daily_quota(conn, s["id"], wb["deadline"], exclude_today=True)
                total_quota += quota_info.get("daily_quota", 0)

        # 今日完了したタスク：pass1が今日の数 + pass2が今日の数 (停止中のものは含めない)
        done_p1 = conn.execute("""
            SELECT COUNT(*) FROM problems p 
            JOIN subjects s ON s.id = p.subject_id
            WHERE DATE(p.pass1_date) = DATE(?) AND s.is_paused = 0
        """, (today,)).fetchone()[0]
        done_p2 = conn.execute("""
            SELECT COUNT(*) FROM problems p 
            JOIN subjects s ON s.id = p.subject_id
            WHERE DATE(p.pass2_date) = DATE(?) AND s.is_paused = 0
        """, (today,)).fetchone()[0]
        done_quota = done_p1 + done_p2

        # SRSの進捗 (停止中の題材のSRSは含めない)
        srs_stats = conn.execute("""
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN DATE(si.last_review) = DATE(?) THEN 1 END) as done
            FROM srs_items si
            JOIN problems p ON p.id = si.problem_id
            JOIN subjects s ON s.id = p.subject_id
            WHERE (DATE(si.due_date) <= DATE(?) OR DATE(si.last_review) = DATE(?))
            AND s.is_paused = 0
        """, (today, today, today)).fetchone()
        
        srs_total = srs_stats["total"]
        srs_done = srs_stats["done"]
        
        return {"done": done_quota + srs_done, "total": total_quota + srs_total, "srs_total": srs_total, "srs_done": srs_done}
    except Exception as e:
        print(f"Error in today_stats: {e}")
        return {"done": 0, "total": 0, "srs_total": 0, "srs_done": 0, "error": str(e)}
    finally:
        conn.close()

@app.get("/api/stats/hourly")
def hourly_stats(day: Optional[str] = None):
    day = day or datetime.now(JST).date().isoformat()
    conn = get_db()
    rows = conn.execute("""
        SELECT strftime('%H', timestamp) as hour, s.type_tag, al.action_type, COUNT(*) as cnt
        FROM activity_log al JOIN subjects s ON s.id = al.subject_id
        WHERE timestamp >= ? AND timestamp <= ? GROUP BY hour, s.type_tag, al.action_type
    """, (f"{day}T07:00:00", f"{day}T20:59:59")).fetchall()
    res = {"暗記": {}, "問題": {}}
    for r in rows:
        h, t, a = int(r["hour"]), r["type_tag"], ("review" if r["action_type"] == "srs" else "new")
        res.setdefault(t, {})
        if h not in res[t]: res[t][h] = {"new": 0, "review": 0}
        res[t][h][a] = r["cnt"]
    conn.close()
    return res

@app.get("/api/history")
def get_history():
    conn = get_db()
    rows = conn.execute("""
        SELECT 
            DATE(al.timestamp) as log_date,
            s.name as subject_name,
            p.label as problem_label,
            al.action_type,
            al.result
        FROM activity_log al
        JOIN problems p ON p.id = al.problem_id
        JOIN subjects s ON s.id = al.subject_id
        ORDER BY al.timestamp DESC, al.id DESC
    """).fetchall()
    conn.close()
    
    # Group by date
    history_map = {}
    for r in rows:
        d = r["log_date"]
        if d not in history_map:
            history_map[d] = []
        history_map[d].append({
            "subject_name": r["subject_name"],
            "problem_label": r["problem_label"],
            "action_type": r["action_type"],
            "result": r["result"]
        })
        
    result = []
    for d in sorted(history_map.keys(), reverse=True):
        result.append({
            "date": d,
            "activities": history_map[d]
        })
    return result

@app.post("/api/admin/slack/today-notify", dependencies=[Depends(verify_admin)])
def notify_today_tab_to_slack_now():
    try:
        return send_today_progress_to_slack()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Slack notify failed: {e}")

@app.post("/api/admin/blinko/sync")
def sync_to_blinko_now():
    try:
        from blinko_sync import collect_summary, send_to_blinko
        summary = collect_summary()
        res = send_to_blinko(summary)
        return {"ok": True, "result": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Blinko sync failed: {e}")

# ── SPA ───────────────────────────────────────────────────────
@app.get("/")
def root(): return FileResponse("/app/frontend/index.html")

@app.get("/manifest.json")
def get_manifest(): return FileResponse("/app/frontend/manifest.json")

@app.get("/sw.js")
def get_sw(): return FileResponse("/app/frontend/sw.js")

@app.get("/{path:path}")
def spa(path: str):
    # 'api' で始まるパス、または空でないファイル拡張子を持つパス（staticファイル等）が
    # ここに来た場合は、SPAとして扱わず404を返す。
    # これにより、APIの打ち間違いや存在しない静的ファイルでindex.htmlが返るのを防ぐ。
    if path.split("/")[0] == "api":
        raise HTTPException(status_code=404)
    
    if "." in path and not path.endswith(".html"):
        full_path = f"/app/frontend/{path}"
        if os.path.exists(full_path) and os.path.isfile(full_path):
            return FileResponse(full_path)
        raise HTTPException(status_code=404)
        
    return FileResponse("/app/frontend/index.html")
