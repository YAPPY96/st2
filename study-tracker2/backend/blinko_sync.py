import os
import json
import sqlite3
import urllib.request
from datetime import datetime, date
import math
from logic import calc_daily_quota

DB_PATH = "/data/study.db"
if not os.path.exists(DB_PATH):
    # Fallback for local development
    DB_PATH = "data/study.db"

BLINKO_API_URL = os.getenv("BLINKO_API_URL", "").strip() or "https://record.yappy.dpdns.org/api/v1/note/upsert"
BLINKO_TOKEN = os.getenv("BLINKO_TOKEN", "").strip() or "eyJ9.eyJyb2xlIjoic3VwZXJhZG1pbiIsIm5hbWUiOiJ5YXBweSIsInN1YiI6IjEiLCJleHAiOjQ5MzUyOTg0NzAsImlhdCI6MTc4MTY5ODQ3MH0.VTtlpwuU_F8rgUnHQ4Ug0hnPObUqPCr4znelLi7vpa0"
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def collect_summary():
    conn = get_db()
    today = date.today().isoformat()
    
    # 1. Today's Progress
    subjects = conn.execute("""
        SELECT s.id, s.name, w.deadline
        FROM subjects s
        LEFT JOIN workbooks w ON w.subject_id = s.id
        WHERE s.is_paused = 0
    """).fetchall()
    
    subject_summaries = []
    total_srs_done = 0
    total_srs_due = 0
    total_new_quota = 0
    
    for s in subjects:
        # Use the logic from logic.py
        q = calc_daily_quota(conn, s["id"], s["deadline"], exclude_today=True)
        
        # quota.get("today_done") in logic.py is min(srs_due, srs_done)
        # We want to show the actual SRS progress
        srs_stats = conn.execute("""
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN DATE(last_review) = DATE(?) THEN 1 END) as done
            FROM srs_items si
            JOIN problems p ON p.id = si.problem_id
            WHERE p.subject_id = ? AND (DATE(si.due_date) <= DATE(?) OR DATE(si.last_review) = DATE(?))
        """, (today, s["id"], today, today)).fetchone()
        
        done = srs_stats["done"]
        due = srs_stats["total"]
        quota = q.get("daily_quota", 0)
        
        total_srs_done += done
        total_srs_due += due
        total_new_quota += quota
        
        subject_summaries.append(f"・{s['name']}: 復習 {done}/{due}済")

    # 2. Total Remaining Load
    total_probs = conn.execute("SELECT COUNT(*) FROM problems").fetchone()[0]
    pass1_done = conn.execute("SELECT COUNT(*) FROM problems WHERE pass1_date IS NOT NULL").fetchone()[0]
    pass2_done = conn.execute("SELECT COUNT(*) FROM problems WHERE pass2_date IS NOT NULL").fetchone()[0]
    
    remaining_tasks = (total_probs * 2) - (pass1_done + pass2_done)
    
    # 3. Recent Activity
    recent = conn.execute("""
        SELECT COUNT(*) FROM activity_log 
        WHERE DATE(timestamp) = DATE(?)
    """, (today,)).fetchone()[0]

    conn.close()
    
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    content = f"""📊 学習記録 ({now_str})

✅ 今日の進捗
- 復習(SRS): {total_srs_done} / {total_srs_due} 完了


📚 各科目の状況
{chr(10).join(subject_summaries)}

#学習記録
"""
    return content

def send_to_blinko(content):
    payload = json.dumps({
        "content": content,
        "type": 0
    }).encode("utf-8")
    
    req = urllib.request.Request(
        BLINKO_API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {BLINKO_TOKEN}"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    summary = collect_summary()
    print("Sending following summary to Blinko:")
    print(summary)
    result = send_to_blinko(summary)
    print("Response from Blinko:", result)
