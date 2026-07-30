from datetime import date, timedelta
import math

# ── FSRS Algorithm ──────────────────────────────────────────
def calculate_next_srs(rating: int, stability: float, difficulty: float):
    d_delta = {1: 1.0, 2: 0.5, 3: 0.0, 4: -0.5}[rating]
    new_difficulty = max(1.0, min(10.0, difficulty + d_delta))
    
    if rating == 1:
        new_stability = 0.25
    else:
        multipliers = {2: 1.2, 3: 2.5, 4: 4.0}
        adj_mult = multipliers[rating] * (1.1 - (new_difficulty / 10.0) * 0.2)
        new_stability = stability * adj_mult
    
    if rating > 1:
        new_stability = max(1.0, new_stability)
        
    return new_stability, new_difficulty

# ── Quota Calculation ───────────────────────────────────────
def calc_daily_quota(conn, subject_id: int, deadline_str: str = None, exclude_today: bool = False) -> dict:
    today = date.today()
    today_str = today.isoformat()

    def day_part(value):
        if not value:
            return None
        # pass1_date / pass2_date が日時文字列でも日付比較できるようにする
        return str(value)[:10]
    
    probs = conn.execute(
        "SELECT id, label, pass1_date, pass2_date FROM problems WHERE subject_id=? ORDER BY sort_order, LENGTH(label), label",
        (subject_id,)
    ).fetchall()
    
    total = len(probs)
    if exclude_today:
        pass1_done_count = sum(1 for p in probs if (day_part(p["pass1_date"]) and day_part(p["pass1_date"]) < today_str))
        pass2_done_count = sum(1 for p in probs if (day_part(p["pass2_date"]) and day_part(p["pass2_date"]) < today_str))
        today_done_p1 = sum(1 for p in probs if day_part(p["pass1_date"]) == today_str)
        today_done_p2 = sum(1 for p in probs if day_part(p["pass2_date"]) == today_str)
    else:
        pass1_done_count = sum(1 for p in probs if day_part(p["pass1_date"]))
        pass2_done_count = sum(1 for p in probs if day_part(p["pass2_date"]))
        today_done_p1 = sum(1 for p in probs if day_part(p["pass1_date"]) == today_str)
        today_done_p2 = sum(1 for p in probs if day_part(p["pass2_date"]) == today_str)
    
    total_tasks = total * 2
    
    # SRS (復習) タスクを合算
    srs_stats = conn.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN DATE(last_review) = DATE(?) THEN 1 END) as done
        FROM srs_items si
        JOIN problems p ON p.id = si.problem_id
        WHERE p.subject_id = ? AND (DATE(si.due_date) <= DATE(?) OR DATE(si.last_review) = DATE(?))
    """, (today_str, subject_id, today_str, today_str)).fetchone()

    srs_due = srs_stats["total"]
    srs_done = srs_stats["done"]

    quota = 0
    remaining_days = 0
    deadline_valid = False
    if deadline_str:
        try:
            deadline = date.fromisoformat(deadline_str)
            remaining_days = max(1, (deadline - today).days)
            quota = math.ceil(max(0, total_tasks - (pass1_done_count + pass2_done_count)) / remaining_days)
            deadline_valid = True
        except:
            pass
    
    first_unfinished = next((i for i, p in enumerate(probs) if not p["pass2_date"]), 0)
    
    # 今日タブの分母は「復習対象数のみ」
    today_target_total = srs_due
    today_done_total = min(today_target_total, srs_done)

    # Calculate schedule
    schedule = []
    if deadline_valid:
        remaining_tasks = []
        for p in probs:
            if not p["pass1_date"]: remaining_tasks.append(f"{p['label']}(①)")
        for p in probs:
            if not p["pass2_date"]: remaining_tasks.append(f"{p['label']}(②)")

        tasks_per_day = math.ceil(len(remaining_tasks) / remaining_days)
        for i in range(min(remaining_days, 31)):
            d = today + timedelta(days=i)
            s_idx = i * tasks_per_day
            e_idx = min(len(remaining_tasks), (i + 1) * tasks_per_day)
            day_tasks = remaining_tasks[s_idx:e_idx]
            if not day_tasks and i >= remaining_days: break
            schedule.append({
                "date": d.isoformat(),
                "label": d.strftime("%m/%d"),
                "count": len(day_tasks),
                "range": f"{day_tasks[0]} 〜 {day_tasks[-1]}" if len(day_tasks) > 1 else (day_tasks[0] if day_tasks else "目標なし")
            })

    return {
        "total": total, "total_tasks": total_tasks,
        "pass1_done": pass1_done_count, "pass2_done": pass2_done_count,
        "completed_tasks": pass1_done_count + pass2_done_count, "remaining_days": remaining_days,
        "daily_quota": quota, "target_start": first_unfinished + 1, "target_end": min(total, first_unfinished + quota),
        "deadline": deadline_str, "schedule": schedule, "behind": False,
        "today_done": today_done_total, "today_total": today_target_total,
        "no_deadline": not deadline_valid
    }
