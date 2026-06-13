from datetime import datetime, timedelta
from pathlib import Path
import os
import random
import re

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:  # PostgreSQL is enabled only when DATABASE_URL is set.
    psycopg2 = None
    RealDictCursor = None

from flask import Flask, jsonify, request
from flask_cors import CORS


BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
USE_POSTGRES = bool(DATABASE_URL)
FRONTEND_URL = os.getenv("FRONTEND_URL", "*").strip() or "*"

app = Flask(__name__)
CORS(app, origins=[FRONTEND_URL] if FRONTEND_URL != "*" else "*")

TASK_REWARDS = [20, 25, 30, 35, 40, 45, 50]
DRAW_COST = 50
CARD_ICON_KEYS = [
    "cat-party.png",
    "money-bag.png",
    "crown.png",
    "game.png",
    "task-list.png",
    "friends.png",
    "cup.png",
    "cat-book.png",
    "cat-face.png",
]
RARITY_WEIGHTS = {
    "普通": 60,
    "稀有": 25,
    "史詩": 10,
    "傳說": 5,
}


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def adapt_postgres_sql(sql):
    sql = sql.replace("SERIAL PRIMARY KEY", "SERIAL PRIMARY KEY")
    sql = re.sub(r"datetime\(([^)]+)\)", r"\1", sql)
    sql = sql.replace("?", "%s")
    return sql


def should_return_id(sql):
    normalized = sql.strip().upper()
    return normalized.startswith("INSERT INTO") and " RETURNING " not in normalized


class PostgresCursor:
    def __init__(self, cursor):
        self.cursor = cursor
        self.lastrowid = None

    def execute(self, sql, params=None):
        query = adapt_postgres_sql(sql)
        added_returning = False
        if should_return_id(query):
            query = query.rstrip().rstrip(";") + " RETURNING id"
            added_returning = True
        self.cursor.execute(query, params or ())
        if added_returning and self.cursor.description:
            row = self.cursor.fetchone()
            self.lastrowid = row["id"] if row else None
        return self

    def executescript(self, script):
        for statement in script.split(";"):
            statement = statement.strip()
            if statement:
                self.execute(statement)
        return self

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()

    def __iter__(self):
        return iter(self.cursor)


class PostgresConnection:
    is_postgres = True

    def __init__(self, raw_conn):
        self.raw_conn = raw_conn

    def cursor(self):
        return PostgresCursor(self.raw_conn.cursor(cursor_factory=RealDictCursor))

    def execute(self, sql, params=None):
        cursor = self.cursor()
        return cursor.execute(sql, params)

    def commit(self):
        self.raw_conn.commit()

    def close(self):
        self.raw_conn.close()


def get_conn():
    if not USE_POSTGRES:
        raise RuntimeError("DATABASE_URL is required for PostgreSQL deployment.")
    if psycopg2 is None:
        raise RuntimeError("PostgreSQL \u9700\u8981\u5b89\u88dd psycopg2-binary\uff0c\u8acb\u57f7\u884c\uff1apip install psycopg2-binary")
    return PostgresConnection(psycopg2.connect(DATABASE_URL))


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def create_notification(conn, group_id, title, message, notification_type="system", user_id=None):
    conn.execute(
        """
        INSERT INTO notifications (group_id, user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        """,
        (group_id, user_id, title, message, notification_type, now()),
    )


def table_columns(conn, table):
    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        """,
        (table,),
    ).fetchall()
    return {row["column_name"] for row in rows}


def add_column(conn, table, column_sql):
    column_name = column_sql.split()[0]
    if column_name not in table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_sql}")


def normalize_user_row(row):
    if not row:
        return None
    data = dict(row)
    nickname = data.get("nickname") or data.get("name") or ""
    coins = data.get("coins")
    if coins is None:
        coins = data.get("coin", 0)
    return {
        "id": data["id"],
        "nickname": nickname,
        "name": nickname,
        "email": data.get("email", ""),
        "coins": coins or 0,
        "coin": coins or 0,
        "avatar": data.get("avatar", "book"),
    }


def ensure_unique_user_fields(conn):
    users = conn.execute("SELECT id, name, nickname, email, coin, coins FROM users ORDER BY id").fetchall()
    used_nicknames = set()
    used_emails = set()

    for user in users:
        base_nickname = (user["nickname"] or user["name"] or f"user{user['id']}").strip()
        nickname = base_nickname
        suffix = 2
        while nickname in used_nicknames:
            nickname = f"{base_nickname}{suffix}"
            suffix += 1
        used_nicknames.add(nickname)

        base_email = (user["email"] or f"user{user['id']}@local.study").strip().lower()
        email = base_email
        suffix = 2
        while email in used_emails:
            local, _, domain = base_email.partition("@")
            email = f"{local}{suffix}@{domain or 'local.study'}"
            suffix += 1
        used_emails.add(email)

        coins = user["coins"] if user["coins"] is not None else (user["coin"] or 0)
        conn.execute(
            "UPDATE users SET nickname = ?, name = ?, email = ?, coins = ?, coin = ? WHERE id = ?",
            (nickname, nickname, email, coins, coins, user["id"]),
        )


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT,
            avatar TEXT DEFAULT 'book',
            coin INTEGER DEFAULT 0,
            nickname TEXT,
            email TEXT,
            password TEXT,
            coins INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            passcode TEXT NOT NULL,
            announcement TEXT DEFAULT '',
            created_by INTEGER,
            total_coin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS group_members (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            joined_at TEXT DEFAULT '',
            role TEXT DEFAULT 'member',
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS group_announcements (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'project',
            assigned_to INTEGER,
            reward INTEGER DEFAULT 20,
            coin_reward INTEGER DEFAULT 20,
            status TEXT DEFAULT 'pending',
            is_completed INTEGER DEFAULT 0,
            is_featured INTEGER DEFAULT 0,
            deadline TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT DEFAULT '',
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(assigned_to) REFERENCES users(id),
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS coin_history (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            user_id INTEGER,
            amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS rewards (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            cost INTEGER NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id)
        );

        CREATE TABLE IF NOT EXISTS reward_exchanges (
            id SERIAL PRIMARY KEY,
            reward_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            cost INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(reward_id) REFERENCES rewards(id),
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS reward_cards (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT NOT NULL,
            rarity TEXT NOT NULL,
            weight INTEGER DEFAULT 60,
            icon_key TEXT,
            created_by INTEGER,
            status TEXT DEFAULT 'pending',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS reward_card_approvals (
            id SERIAL PRIMARY KEY,
            reward_card_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            approved_at TEXT NOT NULL,
            FOREIGN KEY(reward_card_id) REFERENCES reward_cards(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS user_reward_cards (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            reward_card_id INTEGER NOT NULL,
            source_task_id INTEGER,
            status TEXT DEFAULT 'unused',
            obtained_at TEXT NOT NULL,
            used_at TEXT DEFAULT '',
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(reward_card_id) REFERENCES reward_cards(id),
            FOREIGN KEY(source_task_id) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS study_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            group_id INTEGER,
            subject TEXT,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            duration_seconds INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            earned_coins INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(group_id) REFERENCES groups(id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            user_id INTEGER,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'system',
            is_read INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )

    add_column(conn, "users", "nickname TEXT")
    add_column(conn, "users", "email TEXT")
    add_column(conn, "users", "password TEXT")
    add_column(conn, "users", "coins INTEGER DEFAULT 0")
    add_column(conn, "users", "name TEXT")
    add_column(conn, "users", "avatar TEXT DEFAULT 'book'")
    add_column(conn, "users", "coin INTEGER DEFAULT 0")
    add_column(conn, "reward_cards", "status TEXT DEFAULT 'active'")
    add_column(conn, "reward_cards", "icon_key TEXT")
    add_column(conn, "groups", "announcement TEXT DEFAULT ''")
    add_column(conn, "groups", "created_by INTEGER")
    add_column(conn, "group_members", "joined_at TEXT DEFAULT ''")
    add_column(conn, "tasks", "coin_reward INTEGER DEFAULT 20")
    add_column(conn, "tasks", "is_completed INTEGER DEFAULT 0")
    add_column(conn, "tasks", "is_featured INTEGER DEFAULT 0")
    add_column(conn, "tasks", "due_date TEXT DEFAULT ''")
    add_column(conn, "study_sessions", "group_id INTEGER")
    add_column(conn, "study_sessions", "subject TEXT")
    add_column(conn, "study_sessions", "earned_coins INTEGER DEFAULT 0")
    ensure_unique_user_fields(conn)

    conn.execute("UPDATE tasks SET coin_reward = reward WHERE coin_reward IS NULL")
    conn.execute("UPDATE tasks SET due_date = deadline WHERE (due_date IS NULL OR due_date = '') AND deadline IS NOT NULL")
    conn.execute("UPDATE tasks SET is_completed = 1 WHERE status IN ('completed', 'done', '已完成')")
    conn.execute(
        """
        UPDATE groups
        SET created_by = (
            SELECT user_id
            FROM group_members
            WHERE group_members.group_id = groups.id
            ORDER BY id ASC
            LIMIT 1
        )
        WHERE created_by IS NULL
        """
    )
    conn.execute(
        """
        INSERT INTO group_announcements (group_id, user_id, content, created_at)
        SELECT groups.id,
               COALESCE(groups.created_by, (
                   SELECT user_id
                   FROM group_members
                   WHERE group_members.group_id = groups.id
                   ORDER BY id ASC
                   LIMIT 1
               )),
               groups.announcement,
               COALESCE(groups.created_at, ?)
        FROM groups
        WHERE TRIM(COALESCE(groups.announcement, '')) != ''
          AND NOT EXISTS (
              SELECT 1 FROM group_announcements
              WHERE group_announcements.group_id = groups.id
          )
          AND COALESCE(groups.created_by, (
              SELECT user_id
              FROM group_members
              WHERE group_members.group_id = groups.id
              ORDER BY id ASC
              LIMIT 1
          )) IS NOT NULL
        """,
        (now(),),
    )

    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique ON users(nickname)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_passcode_unique ON groups(passcode)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique ON group_members(group_id, user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_sessions_user_time ON study_sessions(user_id, start_time)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_sessions_group_time ON study_sessions(group_id, start_time)")

    group_count = cur.execute("SELECT COUNT(*) AS c FROM groups").fetchone()["c"]
    if group_count == 0:
        cur.execute(
            "INSERT INTO groups (name, passcode, announcement, created_by, total_coin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("期末專題共讀小隊", "studymeal", "本週目標：完成簡報與系統展示", 1, 0, now()),
        )
        group_id = cur.lastrowid
        seed_users = [
            ("小雯", "wen@example.com", "123456"),
            ("阿澤", "ze@example.com", "123456"),
            ("小晴", "qing@example.com", "123456"),
        ]
        for idx, (nickname, email, password) in enumerate(seed_users):
            cur.execute(
                """
                INSERT INTO users (name, nickname, email, password, avatar, coin, coins, created_at)
                VALUES (?, ?, ?, ?, 'book', 0, 0, ?)
                """,
                (nickname, nickname, email, password, now()),
            )
            user_id = cur.lastrowid
            role = "owner" if idx == 0 else "member"
            cur.execute(
                "INSERT INTO group_members (group_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)",
                (group_id, user_id, now(), role),
            )

        seed_tasks = [
            ("整理需求文件", "把專題需求整理成可以分工的任務清單", 1, 50, "2026-06-10"),
            ("修改 Class Diagram", "確認使用者、任務、卡牌與歷程之間的關係", 2, 40, "2026-06-12"),
            ("準備期末簡報", "整理系統特色、流程圖與展示腳本", 3, 35, "2026-06-14"),
        ]
        for title, desc, assigned, reward, deadline in seed_tasks:
            cur.execute(
                """
                INSERT INTO tasks (group_id, title, description, assigned_to, reward, status, deadline, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, 1, ?)
                """,
                (group_id, title, desc, assigned, reward, deadline, now()),
            )

    seed_default_cards(conn)
    conn.commit()
    conn.close()


def seed_default_cards(conn):
    groups = conn.execute("SELECT id FROM groups").fetchall()
    for group in groups:
        count = conn.execute("SELECT COUNT(*) AS c FROM reward_cards WHERE group_id = ?", (group["id"],)).fetchone()["c"]
        if count:
            continue
        cards = [
            ("休息 10 分鐘券", "可以讓自己休息 10 分鐘", "休息獎勵", "普通", 60),
            ("指定組員幫忙檢查簡報券", "可以請一位組員幫忙檢查簡報內容", "組員協助", "稀有", 25),
            ("今天不用報告進度券", "今天可以不用在群組回報進度", "特殊權利", "史詩", 10),
        ]
        for title, description, category, rarity, weight in cards:
            conn.execute(
                """
                INSERT INTO reward_cards (
                    group_id, title, description, category, rarity, weight,
                    icon_key, created_by, status, is_active, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', 1, ?)
                """,
                (group["id"], title, description, category, rarity, weight, random.choice(CARD_ICON_KEYS), now()),
            )


@app.before_request
def prepare_database():
    init_db()


def weighted_draw(cards):
    active_cards = [
        card for card in cards
        if int(card["is_active"] or 0) == 1
        and (card["status"] or "") == "active"
        and int(card["weight"] or 0) > 0
    ]
    if not active_cards:
        return None
    total_weight = sum(int(card["weight"]) for card in active_cards)
    target = random.uniform(0, total_weight)
    cursor = 0
    for card in active_cards:
        cursor += int(card["weight"])
        if target <= cursor:
            return card
    return active_cards[-1]


def get_user_name(conn, user_id):
    user = conn.execute("SELECT nickname, name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return "使用者"
    return user["nickname"] or user["name"] or "使用者"


def group_member_ids(conn, group_id):
    rows = conn.execute("SELECT user_id FROM group_members WHERE group_id = ?", (group_id,)).fetchall()
    return [row["user_id"] for row in rows]


def is_group_member(conn, group_id, user_id):
    if not group_id or not user_id:
        return False
    return bool(conn.execute(
        "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
        (group_id, user_id),
    ).fetchone())


def normalize_task_row(row):
    task = dict(row)
    coin_reward = task.get("coin_reward")
    if coin_reward is None:
        coin_reward = task.get("reward", 0)
    due_date = task.get("due_date") or task.get("deadline") or ""
    is_completed = int(task.get("is_completed") or 0)
    if task.get("status") in ("completed", "done", "已完成"):
        is_completed = 1

    task["coin_reward"] = int(coin_reward or 0)
    task["reward"] = int(coin_reward or 0)
    task["due_date"] = due_date
    task["deadline"] = due_date
    task["is_completed"] = is_completed
    task["is_featured"] = int(task.get("is_featured") or 0)
    task["status"] = "completed" if is_completed else "pending"
    task["assigned_name"] = task.get("assigned_to_nickname") or task.get("assigned_name")
    task["assigned_avatar"] = task.get("assigned_avatar") or "book"
    return task


def fetch_group_tasks(conn, group_id):
    rows = conn.execute(
        """
        SELECT tasks.*,
               assigned.nickname AS assigned_to_nickname,
               assigned.nickname AS assigned_name,
               assigned.avatar AS assigned_avatar,
               creator.nickname AS created_by_nickname
        FROM tasks
        LEFT JOIN users AS assigned ON tasks.assigned_to = assigned.id
        LEFT JOIN users AS creator ON tasks.created_by = creator.id
        WHERE tasks.group_id = ?
        ORDER BY tasks.is_completed ASC, tasks.created_at DESC, tasks.id DESC
        """,
        (group_id,),
    ).fetchall()
    return [normalize_task_row(row) for row in rows]


def fetch_task(conn, task_id):
    row = conn.execute(
        """
        SELECT tasks.*,
               assigned.nickname AS assigned_to_nickname,
               assigned.nickname AS assigned_name,
               assigned.avatar AS assigned_avatar,
               creator.nickname AS created_by_nickname
        FROM tasks
        LEFT JOIN users AS assigned ON tasks.assigned_to = assigned.id
        LEFT JOIN users AS creator ON tasks.created_by = creator.id
        WHERE tasks.id = ?
        """,
        (task_id,),
    ).fetchone()
    return normalize_task_row(row) if row else None


def fetch_group_announcements(conn, group_id):
    rows = conn.execute(
        """
        SELECT group_announcements.*,
               users.nickname,
               users.name
        FROM group_announcements
        LEFT JOIN users ON group_announcements.user_id = users.id
        WHERE group_announcements.group_id = ?
        ORDER BY group_announcements.created_at ASC, group_announcements.id ASC
        """,
        (group_id,),
    ).fetchall()
    announcements = []
    for row in rows:
        item = dict(row)
        item["nickname"] = item.get("nickname") or item.get("name") or "夥伴"
        item.pop("name", None)
        announcements.append(item)
    return announcements


def fetch_group_announcement(conn, announcement_id):
    row = conn.execute(
        """
        SELECT group_announcements.*,
               users.nickname,
               users.name
        FROM group_announcements
        LEFT JOIN users ON group_announcements.user_id = users.id
        WHERE group_announcements.id = ?
        """,
        (announcement_id,),
    ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["nickname"] = item.get("nickname") or item.get("name") or "夥伴"
    item.pop("name", None)
    return item


def group_detail(conn, group_id):
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        return None

    members = conn.execute(
        """
        SELECT users.id, users.nickname AS name, users.nickname, users.email, users.avatar,
               users.coins AS coin, users.coins, group_members.role, group_members.joined_at
        FROM group_members JOIN users ON group_members.user_id = users.id
        WHERE group_members.group_id = ?
        ORDER BY group_members.id ASC
        """,
        (group_id,),
    ).fetchall()
    member_list = rows_to_dicts(members)
    total_coins = sum(int(member.get("coins") or member.get("coin") or 0) for member in member_list)
    group_data = dict(group)
    group_data["total_coin"] = total_coins
    group_data["total_coins"] = total_coins
    group_data["members"] = member_list
    featured_rows = conn.execute(
        """
        SELECT tasks.*,
               assigned.nickname AS assigned_to_nickname,
               assigned.nickname AS assigned_name,
               assigned.avatar AS assigned_avatar,
               creator.nickname AS created_by_nickname
        FROM tasks
        LEFT JOIN users AS assigned ON tasks.assigned_to = assigned.id
        LEFT JOIN users AS creator ON tasks.created_by = creator.id
        WHERE tasks.group_id = ? AND tasks.is_featured = 1
        ORDER BY tasks.is_completed ASC, tasks.created_at DESC, tasks.id DESC
        """,
        (group_id,),
    ).fetchall()
    group_data["featured_tasks"] = [normalize_task_row(row) for row in featured_rows]
    group_data["announcements"] = fetch_group_announcements(conn, group_id)
    return group_data


def approval_counts(conn, card):
    members = group_member_ids(conn, card["group_id"])
    group_member_count = len(members)
    required = group_member_count // 2 + 1
    approved = conn.execute(
        "SELECT COUNT(*) AS c FROM reward_card_approvals WHERE reward_card_id = ?",
        (card["id"],),
    ).fetchone()["c"]
    return approved, required, group_member_count


def add_card_approval(conn, card_id, user_id, approved_at):
    if conn.execute(
        "SELECT 1 FROM reward_card_approvals WHERE reward_card_id = ? AND user_id = ?",
        (card_id, user_id),
    ).fetchone():
        return False
    conn.execute(
        "INSERT INTO reward_card_approvals (reward_card_id, user_id, approved_at) VALUES (?, ?, ?)",
        (card_id, user_id, approved_at),
    )
    return True


def activate_reward_card_if_ready(conn, card):
    approved, required, group_member_count = approval_counts(conn, card)
    activated = False
    if approved >= required and card["status"] != "active":
        conn.execute("UPDATE reward_cards SET status = 'active', is_active = 1 WHERE id = ?", (card["id"],))
        message = f"「{card['title']}」已達到一半以上成員同意，加入國庫卡牌池。"
        conn.execute(
            "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
            (card["group_id"], card["created_by"], message, "卡牌啟用", now()),
        )
        create_notification(conn, card["group_id"], "卡牌已啟用", message, "approval")
        activated = True
    return approved, required, group_member_count, activated


def ensure_reward_card_icons(conn, group_id=None):
    if group_id is None:
        rows = conn.execute(
            "SELECT id FROM reward_cards WHERE icon_key IS NULL OR TRIM(icon_key) = ''"
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id FROM reward_cards
            WHERE group_id = ? AND (icon_key IS NULL OR TRIM(icon_key) = '')
            """,
            (group_id,),
        ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE reward_cards SET icon_key = ? WHERE id = ?",
            (random.choice(CARD_ICON_KEYS), row["id"]),
        )
    return len(rows)


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "message": "StudyTogether API is running"})


@app.route("/api/groups/<int:group_id>/notifications")
def get_notifications(group_id):
    user_id = request.args.get("user_id", type=int)
    conn = get_conn()
    if user_id:
        rows = conn.execute(
            """
            SELECT * FROM notifications
            WHERE group_id = ? AND (user_id IS NULL OR user_id = ?)
            ORDER BY created_at DESC, id DESC
            """,
            (group_id, user_id),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM notifications
            WHERE group_id = ? AND user_id IS NULL
            ORDER BY created_at DESC, id DESC
            """,
            (group_id,),
        ).fetchall()
    conn.close()
    return jsonify({"success": True, "notifications": rows_to_dicts(rows)})


@app.route("/api/notifications/<int:notification_id>/read", methods=["PUT"])
def mark_notification_read(notification_id):
    conn = get_conn()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/groups/<int:group_id>/notifications/read-all", methods=["PUT"])
def mark_all_notifications_read(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_conn()
    if user_id:
        conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE group_id = ? AND (user_id IS NULL OR user_id = ?)",
            (group_id, user_id),
        )
    else:
        conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE group_id = ? AND user_id IS NULL",
            (group_id,),
        )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json() or {}
    nickname = (data.get("nickname") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not nickname or not email or not password:
        return jsonify({"success": False, "message": "欄位不可空白"}), 400
    if "@" not in email:
        return jsonify({"success": False, "message": "Email 格式不正確"}), 400

    conn = get_conn()
    if conn.execute("SELECT 1 FROM users WHERE nickname = ?", (nickname,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "此暱稱已被使用"}), 400
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "此 Email 已註冊過"}), 400

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (name, nickname, email, password, avatar, coin, coins, created_at)
        VALUES (?, ?, ?, ?, 'book', 0, 0, ?)
        """,
        (nickname, nickname, email, password, now()),
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    result = normalize_user_row(user)
    conn.close()
    return jsonify({"success": True, "user": result})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or user["password"] != password:
        conn.close()
        return jsonify({"success": False, "message": "Email 或密碼錯誤"}), 401

    result = normalize_user_row(user)
    conn.close()
    return jsonify({"success": True, "user": result})


@app.route("/api/groups", methods=["POST"])
def create_group():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    passcode = (data.get("passcode") or "").strip()
    announcement = (data.get("announcement") or "").strip()
    user_id = data.get("user_id")

    if not name:
        return jsonify({"success": False, "message": "群組名稱不可空白"}), 400
    if not passcode:
        return jsonify({"success": False, "message": "通關密語不可空白"}), 400
    if not user_id:
        return jsonify({"success": False, "message": "找不到使用者"}), 400

    conn = get_conn()
    user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    if conn.execute("SELECT 1 FROM groups WHERE passcode = ?", (passcode,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "此通關密語已被使用"}), 400

    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO groups (name, passcode, announcement, created_by, total_coin, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (name, passcode, announcement, user_id, created_at),
    )
    group_id = cur.lastrowid
    cur.execute(
        "INSERT INTO group_members (group_id, user_id, joined_at, role) VALUES (?, ?, ?, 'owner')",
        (group_id, user_id, created_at),
    )
    if announcement:
        cur.execute(
            """
            INSERT INTO group_announcements (group_id, user_id, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (group_id, user_id, announcement, created_at),
        )
    seed_default_cards(conn)
    conn.commit()
    group = group_detail(conn, group_id)
    conn.close()
    return jsonify({"success": True, "group": group}), 201


@app.route("/api/users/<int:user_id>/groups")
def get_user_groups(user_id):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT groups.id, groups.name, groups.passcode, groups.announcement,
               groups.created_by, groups.created_at, group_members.joined_at
        FROM group_members
        JOIN groups ON group_members.group_id = groups.id
        WHERE group_members.user_id = ?
        ORDER BY group_members.id DESC
        """,
        (user_id,),
    ).fetchall()
    groups = []
    for row in rows:
        group = dict(row)
        total = conn.execute(
            """
            SELECT COALESCE(SUM(users.coins), 0) AS total
            FROM group_members JOIN users ON group_members.user_id = users.id
            WHERE group_members.group_id = ?
            """,
            (group["id"],),
        ).fetchone()["total"]
        group["total_coin"] = total
        group["total_coins"] = total
        groups.append(group)
    conn.close()
    return jsonify({"success": True, "groups": groups})


@app.route("/api/groups/join", methods=["POST"])
def join_group():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    passcode = (data.get("passcode") or "").strip()
    if not user_id or not passcode:
        return jsonify({"success": False, "message": "通關密語不可空白", "error": "通關密語不可空白"}), 400

    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 404

    group = conn.execute("SELECT * FROM groups WHERE passcode = ?", (passcode,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到此群組，請確認通關密語", "error": "找不到此群組，請確認通關密語"}), 404

    member = conn.execute(
        "SELECT * FROM group_members WHERE group_id = ? AND user_id = ?",
        (group["id"], user_id),
    ).fetchone()
    if not member:
        conn.execute(
            "INSERT INTO group_members (group_id, user_id, joined_at, role) VALUES (?, ?, ?, 'member')",
            (group["id"], user_id, now()),
        )
        conn.commit()

    group_data = group_detail(conn, group["id"])
    result = {"success": True, "group": group_data, "user": normalize_user_row(user)}
    conn.close()
    return jsonify(result)


@app.route("/api/groups/<int:group_id>")
def get_group_detail(group_id):
    conn = get_conn()
    group = group_detail(conn, group_id)
    conn.close()
    if not group:
        return jsonify({"success": False, "message": "找不到群組"}), 404
    return jsonify({"success": True, "group": group})


@app.route("/api/groups/<int:group_id>/name", methods=["PUT"])
def update_group_name(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    name = (data.get("name") or "").strip()

    conn = get_conn()
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到群組", "error": "找不到群組"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以修改群組名稱", "error": "只有群組成員可以修改群組名稱"}), 403
    if not name:
        conn.close()
        return jsonify({"success": False, "message": "群組名稱不可空白", "error": "群組名稱不可空白"}), 400

    conn.execute("UPDATE groups SET name = ? WHERE id = ?", (name, group_id))
    conn.commit()
    updated_group = group_detail(conn, group_id)
    conn.close()
    return jsonify({
        "success": True,
        "message": "群組名稱已更新",
        "group": updated_group,
    })


@app.route("/api/groups/<int:group_id>/announcements", methods=["GET", "POST"])
def group_announcements(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到群組", "error": "找不到群組"}), 404

    if request.method == "GET":
        announcements = fetch_group_announcements(conn, group_id)
        conn.close()
        return jsonify({"success": True, "announcements": announcements})

    data = request.get_json() or {}
    user_id = data.get("user_id")
    content = (data.get("content") or "").strip()
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以發布公告", "error": "只有群組成員可以發布公告"}), 403
    if not content:
        conn.close()
        return jsonify({"success": False, "message": "公告內容不可空白", "error": "公告內容不可空白"}), 400

    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO group_announcements (group_id, user_id, content, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (group_id, user_id, content, created_at),
    )
    username = get_user_name(conn, user_id)
    create_notification(conn, group_id, "新增公告", f"{username}發布了一則群組公告。", "system")
    conn.commit()
    announcement = fetch_group_announcement(conn, cur.lastrowid)
    conn.close()
    return jsonify({
        "success": True,
        "message": "公告已發布",
        "announcement": announcement,
    }), 201


@app.route("/api/groups/<int:group_id>/announcements/<int:announcement_id>", methods=["DELETE"])
def delete_group_announcement(group_id, announcement_id):
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id") or request.args.get("user_id", type=int)

    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到群組", "error": "找不到群組"}), 404
    announcement = conn.execute(
        "SELECT * FROM group_announcements WHERE id = ? AND group_id = ?",
        (announcement_id, group_id),
    ).fetchone()
    if not announcement:
        conn.close()
        return jsonify({"success": False, "message": "找不到公告", "error": "找不到公告"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以刪除公告", "error": "只有群組成員可以刪除公告"}), 403

    conn.execute("DELETE FROM group_announcements WHERE id = ?", (announcement_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "公告已刪除"})


@app.route("/api/groups/<int:group_id>/announcement", methods=["PUT"])
def update_group_announcement(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    announcement = (data.get("announcement") or "").strip()

    conn = get_conn()
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到群組", "error": "找不到群組"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({
            "success": False,
            "message": "只有群組成員可以編輯公告",
            "error": "只有群組成員可以編輯公告",
        }), 403

    conn.execute("UPDATE groups SET announcement = ? WHERE id = ?", (announcement, group_id))
    conn.commit()
    updated_group = group_detail(conn, group_id)
    conn.close()
    return jsonify({
        "success": True,
        "message": "群組公告已更新",
        "group": updated_group,
    })


@app.route("/api/group/<int:group_id>")
def get_group(group_id):
    conn = get_conn()
    group = group_detail(conn, group_id)
    if not group:
        conn.close()
        return jsonify({"error": "找不到群組"}), 404
    conn.close()
    return jsonify({"group": group, "members": group["members"]})


@app.route("/api/tasks/<int:group_id>")
def get_tasks(group_id):
    return get_group_tasks(group_id)


@app.route("/api/groups/<int:group_id>/tasks")
def get_group_tasks(group_id):
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到群組"}), 404
    tasks = fetch_group_tasks(conn, group_id)
    conn.close()
    if request.path.startswith("/api/groups/"):
        return jsonify({"success": True, "tasks": tasks})
    return jsonify(tasks)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json() or {}
    group_id = data.get("group_id")
    return create_group_task(group_id)


@app.route("/api/groups/<int:group_id>/tasks", methods=["POST"])
def create_group_task(group_id):
    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    due_date = (data.get("due_date") or data.get("deadline") or "").strip()
    assigned_to = data.get("assigned_to")
    created_by = data.get("created_by")
    is_featured = 1 if data.get("is_featured") in (1, "1", True, "true", "on") else 0

    if not group_id:
        return jsonify({"success": False, "message": "找不到群組"}), 400
    if not title:
        return jsonify({"success": False, "message": "任務名稱不可空白"}), 400
    if not assigned_to:
        return jsonify({"success": False, "message": "請選擇被分派成員"}), 400
    if not created_by:
        return jsonify({"success": False, "message": "找不到建立者"}), 400

    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到群組"}), 404
    if not is_group_member(conn, group_id, assigned_to):
        conn.close()
        return jsonify({"success": False, "message": "被分派者不是此群組成員"}), 400
    if not is_group_member(conn, group_id, created_by):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以新增任務"}), 403

    coin_reward = random.choice(TASK_REWARDS)
    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO tasks (
            group_id, title, description, category, assigned_to,
            reward, coin_reward, status, is_completed, is_featured, deadline, due_date,
            created_by, created_at, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, '')
        """,
        (
            group_id,
            title,
            description,
            data.get("category", "project"),
            assigned_to,
            coin_reward,
            coin_reward,
            is_featured,
            due_date,
            due_date,
            created_by,
            created_at,
        ),
    )
    creator_name = get_user_name(conn, created_by)
    assignee_name = get_user_name(conn, assigned_to)
    history_message = f"{creator_name}分派任務「{title}」給{assignee_name}，任務獎勵 {coin_reward} 金幣。"
    conn.execute(
        "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
        (group_id, created_by, history_message, "新增任務", created_at),
    )
    create_notification(
        conn,
        group_id,
        "新增任務",
        f"{creator_name}分派了新任務「{title}」給{assignee_name}。",
        "task",
    )
    conn.commit()
    task = fetch_task(conn, cur.lastrowid)
    conn.close()
    return jsonify({"success": True, "task": task}), 201


@app.route("/api/tasks/<int:task_id>/complete", methods=["PUT"])
def complete_task(task_id):
    data = request.get_json() or {}
    completed_by = data.get("user_id")
    conn = get_conn()
    task = fetch_task(conn, task_id)
    if not task:
        conn.close()
        return jsonify({"success": False, "message": "找不到任務", "error": "找不到任務"}), 404
    if int(task["is_completed"] or 0) == 1:
        conn.close()
        return jsonify({"success": False, "message": "此任務已完成", "error": "此任務已完成"}), 400
    if not completed_by:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if int(completed_by) != int(task["assigned_to"]):
        conn.close()
        return jsonify({"success": False, "message": "只有被分派的成員可以完成此任務", "error": "只有被分派的成員可以完成此任務"}), 403

    user_id = completed_by
    reward = int(task["coin_reward"] or task["reward"] or 0)
    completed_at = now()

    conn.execute(
        "UPDATE tasks SET status = 'completed', is_completed = 1, completed_at = ? WHERE id = ?",
        (completed_at, task_id),
    )
    conn.execute("UPDATE users SET coins = coins + ?, coin = coin + ? WHERE id = ?", (reward, reward, user_id))
    conn.execute("UPDATE groups SET total_coin = total_coin + ? WHERE id = ?", (reward, task["group_id"]))

    username = get_user_name(conn, user_id)
    reason = f"{username}完成「{task['title']}」，獲得 {reward} 金幣。"
    conn.execute(
        "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task["group_id"], user_id, reward, reason, "任務完成", completed_at),
    )
    create_notification(conn, task["group_id"], "任務完成", reason, "task")
    conn.commit()
    updated_task = fetch_task(conn, task_id)
    user = conn.execute("SELECT id, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return jsonify({
        "success": True,
        "message": f"任務完成，獲得 {reward} 金幣",
        "coins_added": reward,
        "task": updated_task,
        "user": {"id": user["id"], "coins": user["coins"], "coin": user["coin"]},
    })


@app.route("/api/tasks/<int:task_id>/featured", methods=["PUT"])
def update_task_featured(task_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    is_featured = 1 if data.get("is_featured") in (1, "1", True, "true", "on") else 0

    conn = get_conn()
    task = fetch_task(conn, task_id)
    if not task:
        conn.close()
        return jsonify({"success": False, "message": "找不到任務", "error": "找不到任務"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者", "error": "找不到使用者"}), 400
    if int(user_id) != int(task["created_by"] or 0):
        conn.close()
        return jsonify({
            "success": False,
            "message": "只有任務建立者可以設定重點任務",
            "error": "只有任務建立者可以設定重點任務",
        }), 403

    conn.execute("UPDATE tasks SET is_featured = ? WHERE id = ?", (is_featured, task_id))
    conn.commit()
    updated_task = fetch_task(conn, task_id)
    conn.close()
    message = "已設為重點任務" if is_featured else "已取消重點任務"
    return jsonify({
        "success": True,
        "message": message,
        "task": updated_task,
    })


@app.route("/api/groups/<int:group_id>/reward-cards", methods=["GET", "POST"])
def group_reward_cards(group_id):
    conn = get_conn()
    if request.method == "GET":
        if ensure_reward_card_icons(conn, group_id):
            conn.commit()
        current_user_id = request.args.get("user_id", type=int)
        rows = conn.execute(
            """
            SELECT reward_cards.*, users.nickname AS creator_name, users.nickname AS created_by_nickname
            FROM reward_cards LEFT JOIN users ON reward_cards.created_by = users.id
            WHERE reward_cards.group_id = ?
            ORDER BY reward_cards.id DESC
            """,
            (group_id,),
        ).fetchall()
        cards = []
        for row in rows:
            card = dict(row)
            add_card_approval(conn, row["id"], row["created_by"], row["created_at"])
            approved, required, group_member_count, activated = activate_reward_card_if_ready(conn, row)
            if activated:
                card["status"] = "active"
                card["is_active"] = 1
            card["approval_count"] = approved
            card["required_approvals"] = required
            card["group_member_count"] = group_member_count
            card["current_user_approved"] = False
            if current_user_id:
                card["current_user_approved"] = bool(conn.execute(
                    "SELECT 1 FROM reward_card_approvals WHERE reward_card_id = ? AND user_id = ?",
                    (row["id"], current_user_id),
                ).fetchone())
            cards.append(card)
        conn.commit()
        conn.close()
        return jsonify(cards)

    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    category = data.get("category") or "休息獎勵"
    rarity = data.get("rarity") or "普通"
    weight = RARITY_WEIGHTS.get(rarity, 60)
    created_by = data.get("created_by")
    if not title:
        conn.close()
        return jsonify({"error": "請輸入卡牌名稱"}), 400

    if not is_group_member(conn, group_id, created_by):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以新增卡牌"}), 403

    status = "pending"
    is_active = 0
    icon_key = random.choice(CARD_ICON_KEYS)
    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO reward_cards (
            group_id, title, description, category, rarity, weight,
            icon_key, created_by, status, is_active, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (group_id, title, description, category, rarity, weight, icon_key, created_by, status, is_active, created_at),
    )
    card_id = cur.lastrowid
    add_card_approval(conn, card_id, created_by, created_at)
    creator_name = get_user_name(conn, created_by)
    create_notification(
        conn,
        group_id,
        "卡牌申請",
        f"{creator_name}提出新卡牌「{title}」，等待成員同意。",
        "card",
    )
    card_for_count = conn.execute("SELECT * FROM reward_cards WHERE id = ?", (card_id,)).fetchone()
    approved, required, group_member_count, activated = activate_reward_card_if_ready(conn, card_for_count)
    conn.commit()
    row = conn.execute(
        """
        SELECT reward_cards.*, users.nickname AS creator_name, users.nickname AS created_by_nickname
        FROM reward_cards LEFT JOIN users ON reward_cards.created_by = users.id
        WHERE reward_cards.id = ?
        """,
        (card_id,),
    ).fetchone()
    result = dict(row)
    result["approval_count"] = approved
    result["required_approvals"] = required
    result["group_member_count"] = group_member_count
    result["current_user_approved"] = True
    conn.close()
    return jsonify(result), 201


@app.route("/api/reward-cards/<int:card_id>/approve", methods=["POST"])
def approve_reward_card(card_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_conn()
    card = conn.execute("SELECT * FROM reward_cards WHERE id = ?", (card_id,)).fetchone()
    if not card:
        conn.close()
        return jsonify({"success": False, "message": "找不到卡牌"}), 404
    if card["status"] == "active" and int(card["is_active"] or 0) == 1:
        approved, required, group_member_count = approval_counts(conn, card)
        conn.close()
        return jsonify({
            "success": True,
            "message": "此卡牌已通過",
            "card_status": "active",
            "approval_count": approved,
            "required_approvals": required,
            "group_member_count": group_member_count,
        })
    if user_id not in group_member_ids(conn, card["group_id"]):
        conn.close()
        return jsonify({"success": False, "message": "你不是此群組成員"}), 403
    if conn.execute(
        "SELECT 1 FROM reward_card_approvals WHERE reward_card_id = ? AND user_id = ?",
        (card_id, user_id),
    ).fetchone():
        approved, required, group_member_count = approval_counts(conn, card)
        conn.close()
        return jsonify({
            "success": True,
            "message": "你已同意",
            "card_status": card["status"],
            "approval_count": approved,
            "required_approvals": required,
            "group_member_count": group_member_count,
        })

    approved_at = now()
    add_card_approval(conn, card_id, user_id, approved_at)
    approved, required, group_member_count, activated = activate_reward_card_if_ready(conn, card)
    card_status = "active" if activated else card["status"]
    if activated:
        card_status = "active"
        message = "卡牌已通過並加入國庫卡牌池"
    else:
        message = "已同意，等待更多成員通過"
    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "message": message,
        "card_status": card_status,
        "approval_count": approved,
        "required_approvals": required,
        "group_member_count": group_member_count,
    })


@app.route("/api/groups/<int:group_id>/draw-card", methods=["POST"])
def draw_card(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_conn()
    if ensure_reward_card_icons(conn, group_id):
        conn.commit()
    cards = conn.execute(
        "SELECT * FROM reward_cards WHERE group_id = ? AND status = 'active' AND is_active = 1",
        (group_id,),
    ).fetchall()
    drawn = weighted_draw(cards)
    if not drawn:
        conn.close()
        return jsonify({"success": False, "message": "目前國庫卡牌池沒有可抽取的獎勵卡牌"}), 400

    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    coins = user["coins"] if user["coins"] is not None else user["coin"]
    if int(coins or 0) < DRAW_COST:
        create_notification(conn, group_id, "金幣不足", "金幣不足，無法抽卡。", "draw", user_id)
        conn.commit()
        conn.close()
        return jsonify({"success": False, "message": "金幣不足，無法抽卡"}), 400

    drawn_at = now()
    remaining = int(coins or 0) - DRAW_COST
    conn.execute("UPDATE users SET coins = ?, coin = ? WHERE id = ?", (remaining, remaining, user_id))
    conn.execute(
        """
        INSERT INTO user_reward_cards (user_id, group_id, reward_card_id, source_task_id, status, obtained_at, used_at)
        VALUES (?, ?, ?, NULL, 'unused', ?, '')
        """,
        (user_id, group_id, drawn["id"], drawn_at),
    )
    username = get_user_name(conn, user_id)
    reason = f"{username}花費 {DRAW_COST} 金幣抽卡，抽中「{drawn['title']}」。"
    conn.execute(
        "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (group_id, user_id, -DRAW_COST, reason, "抽卡", drawn_at),
    )
    create_notification(conn, group_id, "抽卡成功", reason, "draw")
    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "message": "抽卡成功",
        "cost": DRAW_COST,
        "remaining_coins": remaining,
        "reward_card": {
            "id": drawn["id"],
            "title": drawn["title"],
            "description": drawn["description"],
            "category": drawn["category"],
            "rarity": drawn["rarity"],
            "icon_key": drawn["icon_key"] or "cat-face.png",
        },
    })


@app.route("/api/users/<int:user_id>/reward-cards")
def user_reward_cards(user_id):
    conn = get_conn()
    if ensure_reward_card_icons(conn):
        conn.commit()
    rows = conn.execute(
        """
        SELECT user_reward_cards.*, reward_cards.title, reward_cards.description,
               reward_cards.category, reward_cards.rarity, reward_cards.weight,
               reward_cards.icon_key,
               tasks.title AS source_task_title
        FROM user_reward_cards
        JOIN reward_cards ON user_reward_cards.reward_card_id = reward_cards.id
        LEFT JOIN tasks ON user_reward_cards.source_task_id = tasks.id
        WHERE user_reward_cards.user_id = ?
        ORDER BY user_reward_cards.id DESC
        """,
        (user_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/user-reward-cards/<int:user_reward_card_id>/use", methods=["PUT"])
def use_user_reward_card(user_reward_card_id):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT user_reward_cards.*, reward_cards.title, users.nickname
        FROM user_reward_cards
        JOIN reward_cards ON user_reward_cards.reward_card_id = reward_cards.id
        JOIN users ON user_reward_cards.user_id = users.id
        WHERE user_reward_cards.id = ?
        """,
        (user_reward_card_id,),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "找不到卡牌"}), 404
    if row["status"] == "used":
        conn.close()
        return jsonify({"error": "卡牌已使用"}), 400

    used_at = now()
    conn.execute(
        "UPDATE user_reward_cards SET status = 'used', used_at = ? WHERE id = ?",
        (used_at, user_reward_card_id),
    )
    reason = f"{row['nickname']}使用了「{row['title']}」。"
    conn.execute(
        "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
        (row["group_id"], row["user_id"], reason, "使用卡牌", used_at),
    )
    create_notification(conn, row["group_id"], "使用卡牌", reason, "card")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "卡牌已使用", "used_at": used_at})


@app.route("/api/history/<int:group_id>")
def get_history(group_id):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT coin_history.*, users.nickname AS user_name, users.avatar AS user_avatar
        FROM coin_history LEFT JOIN users ON coin_history.user_id = users.id
        WHERE coin_history.group_id = ? ORDER BY coin_history.id DESC
        """,
        (group_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


def parse_client_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def date_range(period):
    today = datetime.now().date()
    if period == "week":
        start_date = today - timedelta(days=today.weekday())
        end_date = start_date + timedelta(days=7)
    else:
        start_date = today
        end_date = start_date + timedelta(days=1)
    start = datetime.combine(start_date, datetime.min.time())
    end = datetime.combine(end_date, datetime.min.time())
    return start.strftime("%Y-%m-%d %H:%M:%S"), end.strftime("%Y-%m-%d %H:%M:%S")


def parse_optional_group_id():
    raw_group_id = request.args.get("group_id")
    if raw_group_id in (None, "", "null", "undefined"):
        return None
    try:
        return int(raw_group_id)
    except (TypeError, ValueError):
        return None


def study_summary(conn, user_id, group_id, period):
    start, end = date_range(period)
    if group_id:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes,
                   COUNT(*) AS total_sessions
            FROM study_sessions
            WHERE user_id = ? AND group_id = ? AND start_time >= ? AND start_time < ?
            """,
            (user_id, group_id, start, end),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes,
                   COUNT(*) AS total_sessions
            FROM study_sessions
            WHERE user_id = ? AND group_id IS NULL AND start_time >= ? AND start_time < ?
            """,
            (user_id, start, end),
        ).fetchone()
    return {
        "total_minutes": int(row["total_minutes"] or 0),
        "total_sessions": int(row["total_sessions"] or 0),
    }


@app.route("/api/study-sessions", methods=["POST"])
def create_study_session():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    group_id = data.get("group_id")
    subject = (data.get("subject") or "").strip()
    start_time = parse_client_datetime(data.get("start_time"))
    end_time = parse_client_datetime(data.get("end_time"))

    if not user_id:
        return jsonify({"success": False, "message": "找不到使用者"}), 400
    if not start_time or not end_time:
        return jsonify({"success": False, "message": "讀書時間格式不正確"}), 400
    if end_time <= start_time:
        return jsonify({"success": False, "message": "讀書結束時間必須晚於開始時間"}), 400

    conn = get_conn()
    user = conn.execute("SELECT id, nickname, name, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404

    if group_id in ("", "null", "undefined"):
        group_id = None
    if group_id is not None:
        try:
            group_id = int(group_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"success": False, "message": "群組資料不正確"}), 400
        if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
            conn.close()
            return jsonify({"success": False, "message": "找不到群組"}), 404
        if not is_group_member(conn, group_id, user_id):
            conn.close()
            return jsonify({"success": False, "message": "只有群組成員可以記錄群組讀書時間"}), 403

    duration_seconds = max(0, int((end_time - start_time).total_seconds()))
    duration_minutes = duration_seconds // 60
    earned_coins = (duration_minutes // 10) * 5
    created_at = now()

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO study_sessions (
            user_id, group_id, subject, start_time, end_time,
            duration_seconds, duration_minutes, earned_coins, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            group_id,
            subject,
            start_time.strftime("%Y-%m-%d %H:%M:%S"),
            end_time.strftime("%Y-%m-%d %H:%M:%S"),
            duration_seconds,
            duration_minutes,
            earned_coins,
            created_at,
        ),
    )
    session_id = cur.lastrowid

    current_coins = user["coins"] if user["coins"] is not None else user["coin"]
    next_coins = int(current_coins or 0) + earned_coins
    conn.execute("UPDATE users SET coins = ?, coin = ? WHERE id = ?", (next_coins, next_coins, user_id))

    nickname = user["nickname"] or user["name"] or "使用者"
    display_subject = subject or "自主讀書"
    reason = f"{nickname}完成「{display_subject}」讀書 {duration_minutes} 分鐘，獲得 {earned_coins} 金幣。"
    if group_id:
        if earned_coins:
            conn.execute("UPDATE groups SET total_coin = COALESCE(total_coin, 0) + ? WHERE id = ?", (earned_coins, group_id))
        conn.execute(
            "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (group_id, user_id, earned_coins, reason, "study", created_at),
        )
        create_notification(conn, group_id, "讀書完成", reason, "coin")

    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "message": f"讀書完成 {duration_minutes} 分鐘，獲得 {earned_coins} 金幣",
        "session": {
            "id": session_id,
            "user_id": user_id,
            "group_id": group_id,
            "subject": display_subject,
            "duration_seconds": duration_seconds,
            "duration_minutes": duration_minutes,
            "earned_coins": earned_coins,
            "user_coins": next_coins,
            "created_at": created_at,
        },
    }), 201


@app.route("/api/users/<int:user_id>/study-summary/today")
def get_today_study_summary(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    summary = study_summary(conn, user_id, group_id, "today")
    conn.close()
    return jsonify({"success": True, **summary})


@app.route("/api/users/<int:user_id>/study-summary/week")
def get_week_study_summary(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    summary = study_summary(conn, user_id, group_id, "week")
    conn.close()
    return jsonify({"success": True, **summary})


@app.route("/api/groups/<int:group_id>/study-ranking/week")
def get_group_study_ranking(group_id):
    start, end = date_range("week")
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT users.id AS user_id,
               users.nickname,
               users.name,
               COALESCE(SUM(study_sessions.duration_minutes), 0) AS total_minutes,
               COUNT(study_sessions.id) AS total_sessions
        FROM group_members
        JOIN users ON group_members.user_id = users.id
        LEFT JOIN study_sessions
          ON study_sessions.user_id = users.id
         AND study_sessions.group_id = ?
         AND study_sessions.start_time >= ?
         AND study_sessions.start_time < ?
        WHERE group_members.group_id = ?
        GROUP BY users.id, users.nickname, users.name
        ORDER BY total_minutes DESC, total_sessions DESC, users.id ASC
        """,
        (group_id, start, end, group_id),
    ).fetchall()
    conn.close()
    ranking = []
    for index, row in enumerate(rows, start=1):
        ranking.append({
            "rank": index,
            "user_id": row["user_id"],
            "nickname": row["nickname"] or row["name"] or "使用者",
            "total_minutes": int(row["total_minutes"] or 0),
            "total_sessions": int(row["total_sessions"] or 0),
        })
    return jsonify({"success": True, "ranking": ranking})


@app.route("/api/rewards/<int:group_id>")
def get_rewards(group_id):
    return jsonify([])


@app.route("/api/rewards/exchange", methods=["POST"])
def exchange_reward():
    return jsonify({"error": "固定商品兌換已停用，請使用國庫卡牌池。"}), 410


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
