import sqlite3
import os
from datetime import date

# Docker環境のボリュームマウント先に合わせる
DB_PATH = "/data/study.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT DEFAULT '',
            type_tag TEXT DEFAULT '問題',
            is_paused INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS problems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            group_label TEXT DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            status INTEGER DEFAULT 0,
            pass1_date TEXT DEFAULT NULL,
            pass2_date TEXT DEFAULT NULL,
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            problem_id INTEGER NOT NULL,
            attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5),
            result TEXT CHECK(result IN ('o', 'x', NULL)),
            recorded_at TEXT,
            UNIQUE(problem_id, attempt),
            FOREIGN KEY (problem_id) REFERENCES problems(id)
        );
        CREATE TABLE IF NOT EXISTS daily_goals (
            date TEXT PRIMARY KEY,
            goal INTEGER DEFAULT 20
        );
        CREATE TABLE IF NOT EXISTS srs_items (
            problem_id INTEGER PRIMARY KEY,
            stability REAL NOT NULL,
            difficulty REAL NOT NULL,
            due_date TEXT NOT NULL,
            last_review TEXT,
            reps INTEGER DEFAULT 0,
            lapses INTEGER DEFAULT 0,
            state INTEGER DEFAULT 0,
            FOREIGN KEY (problem_id) REFERENCES problems(id)
        );
        CREATE TABLE IF NOT EXISTS workbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL UNIQUE,
            deadline TEXT,
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            problem_id INTEGER NOT NULL,
            subject_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            result TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (problem_id) REFERENCES problems(id),
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
    """)

    # Migrations
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT type_tag FROM subjects LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("ALTER TABLE subjects ADD COLUMN type_tag TEXT DEFAULT '問題'")
        except:
            pass

    try:
        cursor.execute("SELECT is_paused FROM subjects LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("ALTER TABLE subjects ADD COLUMN is_paused INTEGER DEFAULT 0")
        except:
            pass

    migrate_activity_log(conn)
    migrate_to_srs(conn)
    conn.commit()
    conn.close()

def migrate_activity_log(conn):
    conn.execute("""
        INSERT INTO activity_log (problem_id, subject_id, action_type, result, timestamp)
        SELECT r.problem_id, p.subject_id, 'record', r.result, r.recorded_at
        FROM records r
        JOIN problems p ON p.id = r.problem_id
        WHERE r.recorded_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM activity_log WHERE timestamp = r.recorded_at)
    """)

def migrate_to_srs(conn):
    rows = conn.execute("""
        SELECT DISTINCT problem_id FROM records WHERE result = 'x'
    """).fetchall()
    today = date.today().isoformat()
    for row in rows:
        pid = row["problem_id"]
        exists = conn.execute("SELECT 1 FROM srs_items WHERE problem_id = ?", (pid,)).fetchone()
        if not exists:
            conn.execute("""
                INSERT INTO srs_items (problem_id, stability, difficulty, due_date, reps, lapses, state)
                VALUES (?, 0.5, 5.0, ?, 1, 1, 1)
            """, (pid, today))
