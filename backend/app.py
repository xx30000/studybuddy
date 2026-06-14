from datetime import datetime, timedelta
from pathlib import Path
import base64
import os
import random
import re
import ssl
from urllib.parse import unquote, urlparse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:  # PostgreSQL is enabled only when DATABASE_URL is set.
    psycopg2 = None
    RealDictCursor = None

try:
    import pg8000.dbapi as pg8000
except ImportError:
    pg8000 = None

from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def load_local_env(env_path):
    if not env_path.exists():
        return
    if load_dotenv is not None:
        load_dotenv(env_path, override=False)
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('\"').strip("'")
        os.environ.setdefault(key, value)


BASE_DIR = Path(__file__).resolve().parent
load_local_env(BASE_DIR / ".env")
load_local_env(BASE_DIR.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
USE_POSTGRES = bool(DATABASE_URL)
FRONTEND_URL = os.getenv("FRONTEND_URL", "*").strip() or "*"
FRONTEND_ORIGINS = [origin.strip() for origin in FRONTEND_URL.split(",") if origin.strip()]
DEV_FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
if FRONTEND_URL != "*":
    FRONTEND_ORIGINS = list(dict.fromkeys(FRONTEND_ORIGINS + DEV_FRONTEND_ORIGINS))

app = Flask(__name__)
try:
    app.json.ensure_ascii = False
except Exception:
    app.config["JSON_AS_ASCII"] = False
CORS(app, origins=FRONTEND_ORIGINS if FRONTEND_URL != "*" else "*")


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if FRONTEND_URL == "*":
        response.headers["Access-Control-Allow-Origin"] = origin or "*"
    elif origin in FRONTEND_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

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
    "??": 60,
    "??": 25,
    "??": 10,
    "??": 5,
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
            row = self.fetchone()
            self.lastrowid = row["id"] if row else None
        return self

    def executescript(self, script):
        for statement in script.split(";"):
            statement = statement.strip()
            if statement:
                self.execute(statement)
        return self

    def fetchone(self):
        return self._row_to_dict(self.cursor.fetchone())

    def fetchall(self):
        return [self._row_to_dict(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())

    def _row_to_dict(self, row):
        if row is None:
            return None
        if isinstance(row, dict):
            return row
        if hasattr(row, "keys"):
            return dict(row)
        columns = [description[0] for description in self.cursor.description or []]
        return dict(zip(columns, row))


class PostgresConnection:
    is_postgres = True

    def __init__(self, raw_conn, use_real_dict_cursor=False):
        self.raw_conn = raw_conn
        self.use_real_dict_cursor = use_real_dict_cursor

    def cursor(self):
        if self.use_real_dict_cursor and RealDictCursor is not None:
            return PostgresCursor(self.raw_conn.cursor(cursor_factory=RealDictCursor))
        return PostgresCursor(self.raw_conn.cursor())

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
    if psycopg2 is not None:
        connect_kwargs = {}
        if "sslmode=" not in DATABASE_URL:
            connect_kwargs["sslmode"] = "require"
        return PostgresConnection(psycopg2.connect(DATABASE_URL, **connect_kwargs), use_real_dict_cursor=True)
    if pg8000 is not None:
        parsed = urlparse(DATABASE_URL)
        database = (parsed.path or "/postgres").lstrip("/") or "postgres"
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        raw_conn = pg8000.connect(
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=database,
            ssl_context=ssl_context,
        )
        return PostgresConnection(raw_conn)
    raise RuntimeError("PostgreSQL driver is missing. Install psycopg2-binary or pg8000.")


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
        "avatar_data": data.get("avatar_data"),
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
            avatar_data TEXT,
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

        CREATE TABLE IF NOT EXISTS group_chat_messages (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            is_deleted BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
            id SERIAL PRIMARY KEY,
            requester_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP NULL,
            FOREIGN KEY(requester_id) REFERENCES users(id),
            FOREIGN KEY(receiver_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friendships (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            friend_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(friend_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friend_study_invites (
            id SERIAL PRIMARY KEY,
            inviter_id INTEGER NOT NULL,
            invitee_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            room_id INTEGER NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP NULL,
            expires_at TIMESTAMP NULL,
            FOREIGN KEY(inviter_id) REFERENCES users(id),
            FOREIGN KEY(invitee_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friend_study_rooms (
            id SERIAL PRIMARY KEY,
            created_by INTEGER NOT NULL,
            title TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP NULL,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friend_study_room_members (
            id SERIAL PRIMARY KEY,
            room_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(room_id) REFERENCES friend_study_rooms(id),
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
            todo_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(group_id) REFERENCES groups(id)
        );

        CREATE TABLE IF NOT EXISTS study_checkins (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            group_id INTEGER,
            checkin_date DATE NOT NULL,
            mood TEXT,
            note TEXT,
            study_minutes INTEGER DEFAULT 0,
            earned_coins INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(group_id) REFERENCES groups(id)
        );

        CREATE TABLE IF NOT EXISTS study_todos (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            group_id INTEGER,
            title TEXT NOT NULL,
            is_done BOOLEAN DEFAULT FALSE,
            is_focus BOOLEAN DEFAULT FALSE,
            todo_date DATE NOT NULL,
            due_at TIMESTAMP,
            source_type TEXT DEFAULT 'manual',
            source_id INTEGER,
            notified_before_due BOOLEAN DEFAULT FALSE,
            notified_on_due BOOLEAN DEFAULT FALSE,
            notified_overdue BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    add_column(conn, "users", "avatar_data TEXT")
    add_column(conn, "users", "coin INTEGER DEFAULT 0")
    add_column(conn, "users", "last_seen_at TIMESTAMP")
    add_column(conn, "users", "current_status TEXT DEFAULT 'offline'")
    add_column(conn, "reward_cards", "status TEXT DEFAULT 'active'")
    add_column(conn, "reward_cards", "icon_key TEXT")
    add_column(conn, "groups", "announcement TEXT DEFAULT ''")
    add_column(conn, "groups", "created_by INTEGER")
    add_column(conn, "group_members", "joined_at TEXT DEFAULT ''")
    add_column(conn, "group_chat_messages", "is_deleted BOOLEAN DEFAULT FALSE")
    add_column(conn, "group_chat_messages", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(conn, "tasks", "coin_reward INTEGER DEFAULT 20")
    add_column(conn, "tasks", "is_completed INTEGER DEFAULT 0")
    add_column(conn, "tasks", "is_featured INTEGER DEFAULT 0")
    add_column(conn, "tasks", "due_date TEXT DEFAULT ''")
    add_column(conn, "study_sessions", "group_id INTEGER")
    add_column(conn, "study_sessions", "subject TEXT")
    add_column(conn, "study_sessions", "earned_coins INTEGER DEFAULT 0")
    add_column(conn, "study_sessions", "todo_id INTEGER")
    add_column(conn, "study_sessions", "room_id INTEGER")
    add_column(conn, "study_checkins", "earned_coins INTEGER DEFAULT 0")
    add_column(conn, "study_todos", "is_focus BOOLEAN DEFAULT FALSE")
    add_column(conn, "study_todos", "due_at TIMESTAMP")
    add_column(conn, "study_todos", "source_type TEXT DEFAULT 'manual'")
    add_column(conn, "study_todos", "source_id INTEGER")
    add_column(conn, "study_todos", "notified_before_due BOOLEAN DEFAULT FALSE")
    add_column(conn, "study_todos", "notified_on_due BOOLEAN DEFAULT FALSE")
    add_column(conn, "study_todos", "notified_overdue BOOLEAN DEFAULT FALSE")
    add_column(conn, "study_todos", "completed_at TIMESTAMP")
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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_group_chat_messages_group_created ON group_chat_messages(group_id, created_at)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_sessions_user_time ON study_sessions(user_id, start_time)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_sessions_group_time ON study_sessions(group_id, start_time)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_study_checkins_personal_unique ON study_checkins(user_id, checkin_date) WHERE group_id IS NULL")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_study_checkins_group_unique ON study_checkins(user_id, group_id, checkin_date) WHERE group_id IS NOT NULL")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_checkins_group_date ON study_checkins(group_id, checkin_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_checkins_user_date ON study_checkins(user_id, checkin_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_todos_user_date ON study_todos(user_id, todo_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_todos_group_date ON study_todos(group_id, todo_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_todos_user_focus ON study_todos(user_id, is_focus)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_study_todos_source ON study_todos(source_type, source_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unique ON friendships(user_id, friend_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status ON friend_requests(receiver_id, status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_status ON friend_requests(requester_id, status)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair ON friend_requests(requester_id, receiver_id) WHERE status = 'pending'")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_room_members_unique ON friend_study_room_members(room_id, user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_friend_invites_invitee_status ON friend_study_invites(invitee_id, status)")

    group_count = cur.execute("SELECT COUNT(*) AS c FROM groups").fetchone()["c"]
    if group_count == 0:
        existing_users = cur.execute("SELECT id FROM users ORDER BY id ASC LIMIT 3").fetchall()
        user_ids = [user["id"] for user in existing_users]

        if not user_ids:
            seed_users = [
                ("DemoWen", "wen@example.com", "123456"),
                ("DemoZe", "ze@example.com", "123456"),
                ("DemoQing", "qing@example.com", "123456"),
            ]
            for nickname, email, password in seed_users:
                cur.execute(
                    """
                    INSERT INTO users (name, nickname, email, password, avatar, coin, coins, created_at)
                    VALUES (?, ?, ?, ?, 'book', 0, 0, ?)
                    """,
                    (nickname, nickname, email, password, now()),
                )
                user_ids.append(cur.lastrowid)

        owner_id = user_ids[0]
        announcement = "本週目標：完成簡報與系統展示"
        cur.execute(
            "INSERT INTO groups (name, passcode, announcement, created_by, total_coin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("期末專題小組", "studymeal", announcement, owner_id, 0, now()),
        )
        group_id = cur.lastrowid

        for idx, user_id in enumerate(user_ids):
            role = "owner" if idx == 0 else "member"
            cur.execute(
                "INSERT INTO group_members (group_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)",
                (group_id, user_id, now(), role),
            )

        cur.execute(
            """
            INSERT INTO group_announcements (group_id, user_id, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (group_id, owner_id, announcement, now()),
        )

        seed_tasks = [
            ("完成簡報架構", "整理專題簡報的章節與展示流程", user_ids[0], 50, "2026-06-10"),
            ("修改 Class Diagram", "補上關聯與多重性", user_ids[min(1, len(user_ids) - 1)], 40, "2026-06-12"),
            ("測試登入功能", "確認登入與註冊流程正常", user_ids[min(2, len(user_ids) - 1)], 35, "2026-06-14"),
        ]
        for title, desc, assigned, reward, deadline in seed_tasks:
            cur.execute(
                """
                INSERT INTO tasks (group_id, title, description, assigned_to, reward, status, deadline, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                """,
                (group_id, title, desc, assigned, reward, deadline, owner_id, now()),
            )

    seed_default_cards(conn)
    conn.commit()
    conn.close()


def seed_default_cards(conn):
    groups = conn.execute("SELECT id, created_by FROM groups").fetchall()
    for group in groups:
        count = conn.execute("SELECT COUNT(*) AS c FROM reward_cards WHERE group_id = ?", (group["id"],)).fetchone()["c"]
        if count:
            continue

        creator_id = group["created_by"]
        if not creator_id:
            member = conn.execute(
                "SELECT user_id FROM group_members WHERE group_id = ? ORDER BY id ASC LIMIT 1",
                (group["id"],),
            ).fetchone()
            creator_id = member["user_id"] if member else None
        if not creator_id:
            continue

        cards = [
            ("休息 10 分鐘券", "可以讓自己休息 10 分鐘", "休息獎勵", "普通", 60),
            ("點心補給券", "完成讀書後可以吃一份小點心", "生活小獎", "稀有", 25),
            ("指定讀書音樂券", "可以指定一次共讀背景音樂", "團隊互動", "史詩", 10),
        ]
        for title, description, category, rarity, weight in cards:
            conn.execute(
                """
                INSERT INTO reward_cards (
                    group_id, title, description, category, rarity, weight,
                    icon_key, created_by, status, is_active, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)
                """,
                (group["id"], title, description, category, rarity, weight, random.choice(CARD_ICON_KEYS), creator_id, now()),
            )


def ensure_db_initialized():
    if app.config.get("DB_READY"):
        return
    init_db()
    app.config["DB_READY"] = True


@app.before_request
def prepare_database():
    if request.method == "OPTIONS":
        return ("", 204)
    if request.path in ("/", "/api/health"):
        return None
    try:
        ensure_db_initialized()
    except Exception as exc:
        app.logger.exception("Database initialization failed")
        return jsonify({"success": False, "message": f"Database initialization failed: {exc}"}), 500
    return None


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


def serialize_group_chat_message(row):
    item = dict(row)
    created_at = item.get("created_at")
    updated_at = item.get("updated_at")
    return {
        "id": item.get("id"),
        "group_id": item.get("group_id"),
        "user_id": item.get("user_id"),
        "display_name": item.get("nickname") or item.get("name") or "使用者",
        "avatar_data": item.get("avatar_data"),
        "message": item.get("message") or "",
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or ""),
        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else (str(updated_at) if updated_at else None),
    }


def fetch_group_chat_message(conn, message_id):
    row = conn.execute(
        """
        SELECT group_chat_messages.*,
               users.nickname,
               users.name,
               users.avatar_data
        FROM group_chat_messages
        LEFT JOIN users ON group_chat_messages.user_id = users.id
        WHERE group_chat_messages.id = ?
        """,
        (message_id,),
    ).fetchone()
    return serialize_group_chat_message(row) if row else None


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


@app.route("/api/db-check")
def db_check():
    try:
        ensure_db_initialized()
        return jsonify({"success": True, "message": "Database connection and schema are ready"})
    except Exception as exc:
        app.logger.exception("Database check failed")
        return jsonify({"success": False, "message": str(exc)}), 500


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

    conn = None
    try:
        conn = get_conn()
        if conn.execute("SELECT 1 FROM users WHERE nickname = ?", (nickname,)).fetchone():
            return jsonify({"success": False, "message": "此暱稱已被使用"}), 400
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
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
        return jsonify({"success": True, "user": result})
    except Exception as exc:
        if conn:
            conn.raw_conn.rollback()
        app.logger.exception("Register failed")
        return jsonify({"success": False, "message": f"註冊失敗：{exc}"}), 500
    finally:
        if conn:
            conn.close()


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


@app.route("/api/users/<int:user_id>/profile", methods=["PATCH"])
def update_user_profile(user_id):
    data = request.get_json() or {}
    nickname = (data.get("nickname") or "").strip()
    if not nickname:
        return jsonify({"success": False, "message": "暱稱不可空白"}), 400

    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    duplicate = conn.execute(
        "SELECT id FROM users WHERE nickname = ? AND id <> ?",
        (nickname, user_id),
    ).fetchone()
    if duplicate:
        conn.close()
        return jsonify({"success": False, "message": "此暱稱已被使用"}), 400

    conn.execute("UPDATE users SET nickname = ?, name = ? WHERE id = ?", (nickname, nickname, user_id))
    conn.commit()
    updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    result = normalize_user_row(updated)
    conn.close()
    return jsonify({"success": True, "ok": True, "message": "個人資料已更新", "user": result})


@app.route("/api/users/<int:user_id>/password", methods=["PATCH"])
def update_user_password(user_id):
    data = request.get_json() or {}
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""
    if not current_password or not new_password:
        return jsonify({"success": False, "message": "請輸入目前密碼與新密碼"}), 400
    if len(new_password) < 6:
        return jsonify({"success": False, "message": "新密碼至少需要 6 個字元"}), 400

    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    if user["password"] != current_password:
        conn.close()
        return jsonify({"success": False, "message": "目前密碼不正確"}), 400

    conn.execute("UPDATE users SET password = ? WHERE id = ?", (new_password, user_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "ok": True, "message": "密碼已更新"})


def validate_avatar_data(avatar_data):
    if not isinstance(avatar_data, str):
        return None, "頭像資料格式不正確"
    allowed_prefixes = (
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/jpg;base64,",
        "data:image/webp;base64,",
    )
    if not avatar_data.startswith(allowed_prefixes):
        return None, "頭像只支援 png、jpg、jpeg 或 webp"
    _, _, encoded = avatar_data.partition(",")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except Exception:
        return None, "頭像資料無法解析"
    if len(image_bytes) > 2 * 1024 * 1024:
        return None, "頭像檔案不可超過 2MB"
    return avatar_data, None


@app.route("/api/users/<int:user_id>/avatar", methods=["POST"])
def update_user_avatar(user_id):
    data = request.get_json() or {}
    avatar_data, error = validate_avatar_data(data.get("avatar_data"))
    if error:
        return jsonify({"success": False, "message": error}), 400

    conn = get_conn()
    user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    conn.execute("UPDATE users SET avatar_data = ? WHERE id = ?", (avatar_data, user_id))
    conn.commit()
    updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    result = normalize_user_row(updated)
    conn.close()
    return jsonify({"success": True, "ok": True, "message": "頭像已更新", "user": result})


@app.route("/api/users/<int:user_id>/avatar", methods=["DELETE"])
def delete_user_avatar(user_id):
    conn = get_conn()
    user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404
    conn.execute("UPDATE users SET avatar_data = NULL WHERE id = ?", (user_id,))
    conn.commit()
    updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    result = normalize_user_row(updated)
    conn.close()
    return jsonify({"success": True, "ok": True, "message": "頭像已移除", "user": result})


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


@app.route("/api/groups/<int:group_id>/chat/messages", methods=["GET"])
def get_group_chat_messages(group_id):
    user_id = request.args.get("user_id", type=int)
    try:
        limit = int(request.args.get("limit", 50))
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(limit, 100))

    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到此群組"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "缺少使用者資料"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以查看聊天室"}), 403

    rows = conn.execute(
        """
        SELECT *
        FROM (
            SELECT group_chat_messages.*,
                   users.nickname,
                   users.name,
                   users.avatar_data
            FROM group_chat_messages
            LEFT JOIN users ON group_chat_messages.user_id = users.id
            WHERE group_chat_messages.group_id = ?
              AND COALESCE(group_chat_messages.is_deleted, FALSE) = FALSE
            ORDER BY group_chat_messages.created_at DESC, group_chat_messages.id DESC
            LIMIT ?
        ) AS recent_messages
        ORDER BY recent_messages.created_at ASC, recent_messages.id ASC
        """,
        (group_id, limit),
    ).fetchall()
    messages = [serialize_group_chat_message(row) for row in rows]
    conn.close()
    return jsonify({"success": True, "messages": messages})


@app.route("/api/groups/<int:group_id>/chat/messages", methods=["POST"])
def create_group_chat_message(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    message = (data.get("message") or "").strip()

    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到此群組"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "缺少使用者資料"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以傳送訊息"}), 403
    if not message:
        conn.close()
        return jsonify({"success": False, "message": "訊息不可空白"}), 400
    if len(message) > 500:
        conn.close()
        return jsonify({"success": False, "message": "訊息最多 500 字"}), 400

    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO group_chat_messages (group_id, user_id, message, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, FALSE, ?, ?)
        """,
        (group_id, user_id, message, created_at, created_at),
    )
    conn.commit()
    chat_message = fetch_group_chat_message(conn, cur.lastrowid)
    conn.close()
    return jsonify({
        "success": True,
        "message": "訊息已送出",
        "chat_message": chat_message,
    }), 201


@app.route("/api/groups/<int:group_id>/chat/messages/<int:message_id>", methods=["DELETE"])
def delete_group_chat_message(group_id, message_id):
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id") or request.args.get("user_id", type=int)

    conn = get_conn()
    if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "找不到此群組"}), 404
    if not user_id:
        conn.close()
        return jsonify({"success": False, "message": "缺少使用者資料"}), 400
    if not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以刪除聊天室訊息"}), 403

    message = conn.execute(
        """
        SELECT *
        FROM group_chat_messages
        WHERE id = ? AND group_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
        """,
        (message_id, group_id),
    ).fetchone()
    if not message:
        conn.close()
        return jsonify({"success": False, "message": "找不到此訊息"}), 404
    if int(message["user_id"]) != int(user_id):
        conn.close()
        return jsonify({"success": False, "message": "只能刪除自己送出的訊息"}), 403

    conn.execute(
        "UPDATE group_chat_messages SET is_deleted = TRUE, updated_at = ? WHERE id = ?",
        (now(), message_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "訊息已刪除"})


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


def mark_user_seen(conn, user_id, status="online"):
    conn.execute(
        "UPDATE users SET last_seen_at = ?, current_status = ? WHERE id = ?",
        (now(), status, user_id),
    )


def friend_status_from_seen(row):
    status = row.get("current_status") or "offline"
    if status == "studying":
        return "studying"
    seen = row.get("last_seen_at")
    seen_dt = parse_client_datetime(seen) if seen else None
    if seen_dt and datetime.now() - seen_dt <= timedelta(minutes=5):
        return "online"
    return "offline"


def serialize_friend_user(row, current_user_id=None, conn=None):
    item = dict(row)
    display_name = item.get("nickname") or item.get("name") or f"User {item.get('id')}"
    result = {
        "id": item.get("id"),
        "nickname": display_name,
        "name": display_name,
        "email": item.get("email", ""),
        "avatar": item.get("avatar", "book"),
        "avatar_data": item.get("avatar_data"),
        "coins": item.get("coins") if item.get("coins") is not None else item.get("coin", 0),
        "current_status": friend_status_from_seen(item),
        "is_online": friend_status_from_seen(item) in ("online", "studying"),
    }
    if current_user_id and conn:
        result["friendship_status"] = get_friendship_status(conn, current_user_id, item.get("id"))
    return result


def are_friends(conn, user_id, friend_id):
    return bool(conn.execute(
        "SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?",
        (user_id, friend_id),
    ).fetchone())


def add_friendship_pair(conn, user_id, friend_id):
    if not are_friends(conn, user_id, friend_id):
        conn.execute(
            "INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)",
            (user_id, friend_id, now()),
        )
    if not are_friends(conn, friend_id, user_id):
        conn.execute(
            "INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)",
            (friend_id, user_id, now()),
        )


def get_friendship_status(conn, current_user_id, other_user_id):
    if not current_user_id or not other_user_id:
        return "none"
    if int(current_user_id) == int(other_user_id):
        return "self"
    if are_friends(conn, current_user_id, other_user_id):
        return "friends"
    sent = conn.execute(
        """
        SELECT 1 FROM friend_requests
        WHERE requester_id = ? AND receiver_id = ? AND status = 'pending'
        """,
        (current_user_id, other_user_id),
    ).fetchone()
    if sent:
        return "pending_sent"
    received = conn.execute(
        """
        SELECT 1 FROM friend_requests
        WHERE requester_id = ? AND receiver_id = ? AND status = 'pending'
        """,
        (other_user_id, current_user_id),
    ).fetchone()
    if received:
        return "pending_received"
    return "none"


def common_groups(conn, user_id, friend_id):
    rows = conn.execute(
        """
        SELECT groups.id, groups.name
        FROM groups
        JOIN group_members mine ON mine.group_id = groups.id AND mine.user_id = ?
        JOIN group_members theirs ON theirs.group_id = groups.id AND theirs.user_id = ?
        ORDER BY groups.name ASC
        """,
        (user_id, friend_id),
    ).fetchall()
    return [{"id": row["id"], "name": row["name"]} for row in rows]


def friend_stats(conn, user_id):
    day_start, day_end = date_range("day")
    week_start, week_end = date_range("week")
    minutes = conn.execute(
        """
        SELECT COALESCE(SUM(COALESCE(duration_minutes, FLOOR(duration_seconds / 60))), 0) AS total
        FROM study_sessions
        WHERE user_id = ? AND start_time >= ? AND start_time < ?
        """,
        (user_id, day_start, day_end),
    ).fetchone()
    tasks = conn.execute(
        """
        SELECT COUNT(*) AS total
        FROM tasks
        WHERE assigned_to = ? AND COALESCE(is_completed, 0) = 1
          AND completed_at >= ? AND completed_at < ?
        """,
        (user_id, week_start, week_end),
    ).fetchone()
    checkins = conn.execute(
        """
        SELECT COUNT(*) AS total
        FROM study_checkins
        WHERE user_id = ? AND checkin_date >= ? AND checkin_date < ?
        """,
        (user_id, week_start[:10], week_end[:10]),
    ).fetchone()
    return {
        "today_study_minutes": int(minutes["total"] or 0),
        "week_completed_tasks": int(tasks["total"] or 0),
        "week_checkins": int(checkins["total"] or 0),
    }


def serialize_friend_request(row):
    item = dict(row)
    return {
        "id": item["id"],
        "requester_id": item["requester_id"],
        "receiver_id": item["receiver_id"],
        "status": item.get("status"),
        "created_at": todo_time_to_iso(item.get("created_at")),
        "responded_at": todo_time_to_iso(item.get("responded_at")),
        "requester": {
            "id": item.get("requester_id"),
            "nickname": item.get("requester_nickname") or item.get("requester_name"),
            "email": item.get("requester_email"),
            "avatar_data": item.get("requester_avatar_data"),
            "current_status": friend_status_from_seen({
                "current_status": item.get("requester_status"),
                "last_seen_at": item.get("requester_seen"),
            }),
        },
        "receiver": {
            "id": item.get("receiver_id"),
            "nickname": item.get("receiver_nickname") or item.get("receiver_name"),
            "email": item.get("receiver_email"),
            "avatar_data": item.get("receiver_avatar_data"),
            "current_status": friend_status_from_seen({
                "current_status": item.get("receiver_status"),
                "last_seen_at": item.get("receiver_seen"),
            }),
        },
    }


def friend_request_rows(conn, where_sql, params):
    return conn.execute(
        f"""
        SELECT friend_requests.*,
               requester.nickname AS requester_nickname,
               requester.name AS requester_name,
               requester.email AS requester_email,
               requester.avatar_data AS requester_avatar_data,
               requester.current_status AS requester_status,
               requester.last_seen_at AS requester_seen,
               receiver.nickname AS receiver_nickname,
               receiver.name AS receiver_name,
               receiver.email AS receiver_email,
               receiver.avatar_data AS receiver_avatar_data,
               receiver.current_status AS receiver_status,
               receiver.last_seen_at AS receiver_seen
        FROM friend_requests
        JOIN users requester ON requester.id = friend_requests.requester_id
        JOIN users receiver ON receiver.id = friend_requests.receiver_id
        WHERE {where_sql}
        ORDER BY friend_requests.id DESC
        """,
        params,
    ).fetchall()


@app.route("/api/users/search")
def search_users():
    keyword = (request.args.get("q") or "").strip()
    current_user_id = normalize_optional_group_id(request.args.get("current_user_id"))
    if not keyword:
        return jsonify({"success": True, "users": []})
    conn = get_conn()
    if current_user_id:
        mark_user_seen(conn, current_user_id)
    rows = conn.execute(
        """
        SELECT id, nickname, name, email, avatar, avatar_data, coins, coin, current_status, last_seen_at
        FROM users
        WHERE id <> ?
          AND (LOWER(COALESCE(nickname, name, '')) LIKE LOWER(?) OR LOWER(COALESCE(email, '')) LIKE LOWER(?))
        ORDER BY nickname ASC, id ASC
        LIMIT 20
        """,
        (current_user_id or 0, f"%{keyword}%", f"%{keyword}%"),
    ).fetchall()
    result = [serialize_friend_user(row, current_user_id, conn) for row in rows]
    conn.commit()
    conn.close()
    return jsonify({"success": True, "users": result})


@app.route("/api/friend-requests", methods=["POST"])
def send_friend_request():
    data = request.get_json() or {}
    requester_id = data.get("requester_id")
    receiver_id = data.get("receiver_id")
    if not requester_id or not receiver_id:
        return jsonify({"success": False, "message": "\u8acb\u63d0\u4f9b\u4f7f\u7528\u8005\u8cc7\u6599"}), 400
    if int(requester_id) == int(receiver_id):
        return jsonify({"success": False, "message": "\u4e0d\u80fd\u52a0\u81ea\u5df1\u70ba\u597d\u53cb"}), 400
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM users WHERE id = ?", (receiver_id,)).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u4f7f\u7528\u8005"}), 404
    if are_friends(conn, requester_id, receiver_id):
        conn.close()
        return jsonify({"success": False, "message": "\u4f60\u5011\u5df2\u7d93\u662f\u597d\u53cb"}), 400
    existing = conn.execute(
        """
        SELECT * FROM friend_requests
        WHERE requester_id = ? AND receiver_id = ? AND status = 'pending'
        """,
        (requester_id, receiver_id),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"success": False, "message": "\u5df2\u9001\u51fa\u597d\u53cb\u9080\u8acb"}), 400
    reverse = conn.execute(
        """
        SELECT * FROM friend_requests
        WHERE requester_id = ? AND receiver_id = ? AND status = 'pending'
        """,
        (receiver_id, requester_id),
    ).fetchone()
    if reverse:
        conn.close()
        return jsonify({"success": False, "message": "\u5c0d\u65b9\u5df2\u9080\u8acb\u4f60\uff0c\u8acb\u5230\u9080\u8acb\u5217\u8868\u63a5\u53d7"}), 400
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO friend_requests (requester_id, receiver_id, status, created_at) VALUES (?, ?, 'pending', ?)",
        (requester_id, receiver_id, now()),
    )
    request_id = cur.lastrowid
    conn.commit()
    row = friend_request_rows(conn, "friend_requests.id = ?", (request_id,))[0]
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u9001\u51fa\u597d\u53cb\u9080\u8acb", "request": serialize_friend_request(row)})


@app.route("/api/users/<int:user_id>/friend-requests/incoming")
def get_incoming_friend_requests(user_id):
    conn = get_conn()
    mark_user_seen(conn, user_id)
    rows = friend_request_rows(conn, "friend_requests.receiver_id = ? AND friend_requests.status = 'pending'", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "requests": [serialize_friend_request(row) for row in rows]})


@app.route("/api/users/<int:user_id>/friend-requests/outgoing")
def get_outgoing_friend_requests(user_id):
    conn = get_conn()
    mark_user_seen(conn, user_id)
    rows = friend_request_rows(conn, "friend_requests.requester_id = ? AND friend_requests.status = 'pending'", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "requests": [serialize_friend_request(row) for row in rows]})


@app.route("/api/friend-requests/<int:request_id>/accept", methods=["PATCH"])
def accept_friend_request(request_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u9080\u8acb"}), 404
    if row["status"] != "pending":
        conn.close()
        return jsonify({"success": False, "message": "\u6b64\u9080\u8acb\u5df2\u8655\u7406"}), 400
    responded_at = now()
    conn.execute("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?", (responded_at, request_id))
    add_friendship_pair(conn, row["requester_id"], row["receiver_id"])
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u6210\u70ba\u597d\u53cb"})


@app.route("/api/friend-requests/<int:request_id>/reject", methods=["PATCH"])
def reject_friend_request(request_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u9080\u8acb"}), 404
    conn.execute("UPDATE friend_requests SET status = 'rejected', responded_at = ? WHERE id = ?", (now(), request_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u62d2\u7d55\u597d\u53cb\u9080\u8acb"})


@app.route("/api/friend-requests/<int:request_id>/cancel", methods=["PATCH"])
def cancel_friend_request(request_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u9080\u8acb"}), 404
    conn.execute("UPDATE friend_requests SET status = 'canceled', responded_at = ? WHERE id = ?", (now(), request_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u53d6\u6d88\u597d\u53cb\u9080\u8acb"})


@app.route("/api/users/<int:user_id>/friends")
def get_friends(user_id):
    conn = get_conn()
    mark_user_seen(conn, user_id)
    rows = conn.execute(
        """
        SELECT users.id, users.nickname, users.name, users.email, users.avatar, users.avatar_data,
               users.coins, users.coin, users.current_status, users.last_seen_at
        FROM friendships
        JOIN users ON users.id = friendships.friend_id
        WHERE friendships.user_id = ?
        ORDER BY users.nickname ASC, users.id ASC
        """,
        (user_id,),
    ).fetchall()
    result = []
    for row in rows:
        friend = serialize_friend_user(row)
        stats = friend_stats(conn, friend["id"])
        friend.update(stats)
        friend["common_groups"] = common_groups(conn, user_id, friend["id"])
        result.append(friend)
    conn.commit()
    conn.close()
    return jsonify({"success": True, "friends": result})


@app.route("/api/users/<int:user_id>/friends/<int:friend_id>/profile")
def get_friend_profile(user_id, friend_id):
    conn = get_conn()
    if not are_friends(conn, user_id, friend_id):
        conn.close()
        return jsonify({"success": False, "message": "\u53ea\u80fd\u67e5\u770b\u597d\u53cb\u8cc7\u6599"}), 403
    row = conn.execute(
        """
        SELECT id, nickname, name, email, avatar, avatar_data, coins, coin, current_status, last_seen_at
        FROM users WHERE id = ?
        """,
        (friend_id,),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u597d\u53cb"}), 404
    profile = serialize_friend_user(row)
    profile.update(friend_stats(conn, friend_id))
    profile["common_groups"] = common_groups(conn, user_id, friend_id)
    recent_sessions = conn.execute(
        """
        SELECT subject, duration_minutes, start_time, created_at
        FROM study_sessions
        WHERE user_id = ?
        ORDER BY start_time DESC, id DESC
        LIMIT 5
        """,
        (friend_id,),
    ).fetchall()
    profile["recent_study_sessions"] = rows_to_dicts(recent_sessions)
    conn.close()
    return jsonify({"success": True, "profile": profile})


def serialize_study_invite(row):
    item = dict(row)
    return {
        "id": item["id"],
        "inviter_id": item["inviter_id"],
        "invitee_id": item["invitee_id"],
        "status": item["status"],
        "room_id": item.get("room_id"),
        "created_at": todo_time_to_iso(item.get("created_at")),
        "responded_at": todo_time_to_iso(item.get("responded_at")),
        "expires_at": todo_time_to_iso(item.get("expires_at")),
        "inviter": {
            "id": item.get("inviter_id"),
            "nickname": item.get("inviter_nickname") or item.get("inviter_name"),
            "avatar_data": item.get("inviter_avatar_data"),
        },
        "invitee": {
            "id": item.get("invitee_id"),
            "nickname": item.get("invitee_nickname") or item.get("invitee_name"),
            "avatar_data": item.get("invitee_avatar_data"),
        },
    }


def study_invite_rows(conn, where_sql, params):
    return conn.execute(
        f"""
        SELECT friend_study_invites.*,
               inviter.nickname AS inviter_nickname,
               inviter.name AS inviter_name,
               inviter.avatar_data AS inviter_avatar_data,
               invitee.nickname AS invitee_nickname,
               invitee.name AS invitee_name,
               invitee.avatar_data AS invitee_avatar_data
        FROM friend_study_invites
        JOIN users inviter ON inviter.id = friend_study_invites.inviter_id
        JOIN users invitee ON invitee.id = friend_study_invites.invitee_id
        WHERE {where_sql}
        ORDER BY friend_study_invites.id DESC
        """,
        params,
    ).fetchall()


@app.route("/api/friend-study-invites", methods=["POST"])
def send_friend_study_invite():
    data = request.get_json() or {}
    inviter_id = data.get("inviter_id")
    invitee_id = data.get("invitee_id")
    if not inviter_id or not invitee_id:
        return jsonify({"success": False, "message": "\u8acb\u63d0\u4f9b\u9080\u8acb\u8cc7\u6599"}), 400
    conn = get_conn()
    if not are_friends(conn, inviter_id, invitee_id):
        conn.close()
        return jsonify({"success": False, "message": "\u53ea\u80fd\u9080\u8acb\u597d\u53cb\u4e00\u8d77\u8b80\u66f8"}), 403
    current = conn.execute(
        """
        SELECT id FROM friend_study_invites
        WHERE inviter_id = ? AND invitee_id = ? AND status = 'pending'
        """,
        (inviter_id, invitee_id),
    ).fetchone()
    if current:
        conn.close()
        return jsonify({"success": False, "message": "\u5df2\u9001\u51fa\u4e00\u8d77\u8b80\u66f8\u9080\u8acb"}), 400
    created_at = now()
    expires_at = (datetime.now() + timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO friend_study_invites (inviter_id, invitee_id, status, created_at, expires_at)
        VALUES (?, ?, 'pending', ?, ?)
        """,
        (inviter_id, invitee_id, created_at, expires_at),
    )
    invite_id = cur.lastrowid
    conn.commit()
    row = study_invite_rows(conn, "friend_study_invites.id = ?", (invite_id,))[0]
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u9001\u51fa\u4e00\u8d77\u8b80\u66f8\u9080\u8acb", "invite": serialize_study_invite(row)})


@app.route("/api/users/<int:user_id>/friend-study-invites/incoming")
def get_incoming_friend_study_invites(user_id):
    conn = get_conn()
    rows = study_invite_rows(conn, "friend_study_invites.invitee_id = ? AND friend_study_invites.status = 'pending'", (user_id,))
    conn.close()
    return jsonify({"success": True, "invites": [serialize_study_invite(row) for row in rows]})


@app.route("/api/friend-study-invites/<int:invite_id>/accept", methods=["PATCH"])
def accept_friend_study_invite(invite_id):
    conn = get_conn()
    invite = conn.execute("SELECT * FROM friend_study_invites WHERE id = ?", (invite_id,)).fetchone()
    if not invite:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u9080\u8acb"}), 404
    if invite["status"] != "pending":
        conn.close()
        return jsonify({"success": False, "message": "\u6b64\u9080\u8acb\u5df2\u8655\u7406"}), 400
    inviter_name = get_user_name(conn, invite["inviter_id"])
    invitee_name = get_user_name(conn, invite["invitee_id"])
    created_at = now()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO friend_study_rooms (created_by, title, status, created_at) VALUES (?, ?, 'active', ?)",
        (invite["inviter_id"], f"{inviter_name} \u548c {invitee_name}\u7684\u8b80\u66f8\u623f", created_at),
    )
    room_id = cur.lastrowid
    conn.execute(
        "INSERT INTO friend_study_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)",
        (room_id, invite["inviter_id"], created_at),
    )
    conn.execute(
        "INSERT INTO friend_study_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)",
        (room_id, invite["invitee_id"], created_at),
    )
    conn.execute(
        "UPDATE friend_study_invites SET status = 'accepted', room_id = ?, responded_at = ? WHERE id = ?",
        (room_id, created_at, invite_id),
    )
    conn.commit()
    room = conn.execute("SELECT * FROM friend_study_rooms WHERE id = ?", (room_id,)).fetchone()
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u5efa\u7acb\u597d\u53cb\u8b80\u66f8\u623f", "room": dict(room)})


@app.route("/api/friend-study-invites/<int:invite_id>/reject", methods=["PATCH"])
def reject_friend_study_invite(invite_id):
    conn = get_conn()
    invite = conn.execute("SELECT * FROM friend_study_invites WHERE id = ?", (invite_id,)).fetchone()
    if not invite:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u9080\u8acb"}), 404
    conn.execute("UPDATE friend_study_invites SET status = 'rejected', responded_at = ? WHERE id = ?", (now(), invite_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u62d2\u7d55\u4e00\u8d77\u8b80\u66f8\u9080\u8acb"})


@app.route("/api/friend-study-rooms/<int:room_id>")
def get_friend_study_room(room_id):
    conn = get_conn()
    room = conn.execute("SELECT * FROM friend_study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u8b80\u66f8\u623f"}), 404
    members = conn.execute(
        """
        SELECT users.id, users.nickname, users.name, users.avatar_data, users.current_status, users.last_seen_at
        FROM friend_study_room_members
        JOIN users ON users.id = friend_study_room_members.user_id
        WHERE friend_study_room_members.room_id = ?
        ORDER BY friend_study_room_members.id ASC
        """,
        (room_id,),
    ).fetchall()
    conn.close()
    return jsonify({
        "success": True,
        "room": dict(room),
        "members": [serialize_friend_user(member) for member in members],
    })


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
    minutes_sql = "COALESCE(SUM(COALESCE(duration_minutes, FLOOR(duration_seconds / 60))), 0)"
    if group_id:
        row = conn.execute(
            f"""
            SELECT {minutes_sql} AS total_minutes,
                   COUNT(*) AS total_sessions
            FROM study_sessions
            WHERE user_id = ? AND group_id = ? AND start_time >= ? AND start_time < ?
            """,
            (user_id, group_id, start, end),
        ).fetchone()
    else:
        row = conn.execute(
            f"""
            SELECT {minutes_sql} AS total_minutes,
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



def today_date():
    return datetime.now().date()


def normalize_optional_group_id(value):
    if value in (None, "", "null", "undefined"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def checkin_scope_query(group_id):
    if group_id is None:
        return "group_id IS NULL", ()
    return "group_id = ?", (group_id,)


def serialize_checkin(row):
    if not row:
        return None
    item = dict(row)
    checkin_date = item.get("checkin_date")
    if hasattr(checkin_date, "isoformat"):
        item["checkin_date"] = checkin_date.isoformat()
    created_at = item.get("created_at")
    if hasattr(created_at, "isoformat"):
        item["created_at"] = created_at.isoformat()
    updated_at = item.get("updated_at")
    if hasattr(updated_at, "isoformat"):
        item["updated_at"] = updated_at.isoformat()
    item["study_minutes"] = int(item.get("study_minutes") or 0)
    return item


def fetch_today_checkin(conn, user_id, group_id, target_date=None):
    target_date = target_date or today_date()
    scope_sql, scope_params = checkin_scope_query(group_id)
    return conn.execute(
        f"""
        SELECT * FROM study_checkins
        WHERE user_id = ? AND {scope_sql} AND checkin_date = ?
        ORDER BY id DESC LIMIT 1
        """,
        (user_id, *scope_params, target_date.isoformat()),
    ).fetchone()


def calculate_checkin_streak(conn, user_id, group_id, target_date=None):
    target_date = target_date or today_date()
    scope_sql, scope_params = checkin_scope_query(group_id)
    rows = conn.execute(
        f"""
        SELECT checkin_date
        FROM study_checkins
        WHERE user_id = ? AND {scope_sql} AND checkin_date <= ?
        ORDER BY checkin_date DESC
        """,
        (user_id, *scope_params, target_date.isoformat()),
    ).fetchall()
    dates = []
    for row in rows:
        value = row["checkin_date"]
        if hasattr(value, "isoformat"):
            dates.append(value)
        else:
            dates.append(datetime.strptime(str(value)[:10], "%Y-%m-%d").date())

    if not dates:
        return 0
    expected = target_date if dates[0] == target_date else target_date - timedelta(days=1)
    streak = 0
    seen = set(dates)
    while expected in seen:
        streak += 1
        expected -= timedelta(days=1)
    return streak



def todo_time_to_iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def todo_due_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00").split("+")[0])
    except (TypeError, ValueError):
        return None


def parse_todo_due(value):
    if value in (None, "", "null", "undefined"):
        return None
    parsed = parse_client_datetime(value)
    return parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed else None


def serialize_todo(row):
    if not row:
        return None
    item = dict(row)
    for key in ("todo_date", "due_at", "created_at", "updated_at", "completed_at"):
        item[key] = todo_time_to_iso(item.get(key))
    item["is_done"] = bool(item.get("is_done"))
    item["is_focus"] = bool(item.get("is_focus"))
    item["notified_before_due"] = bool(item.get("notified_before_due"))
    item["notified_on_due"] = bool(item.get("notified_on_due"))
    item["notified_overdue"] = bool(item.get("notified_overdue"))
    due_dt = todo_due_datetime(item.get("due_at"))
    item["is_overdue"] = bool(due_dt and not item["is_done"] and due_dt < datetime.now())
    item["source_type"] = item.get("source_type") or "manual"
    return item


def validate_todo_scope(conn, user_id, group_id):
    user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return (jsonify({"success": False, "message": "\u4f7f\u7528\u8005\u4e0d\u5b58\u5728"}), 404)
    if group_id is not None:
        group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not group:
            return (jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u6b64\u7fa4\u7d44"}), 404)
        if not is_group_member(conn, group_id, user_id):
            return (jsonify({"success": False, "message": "\u4f60\u4e0d\u662f\u6b64\u7fa4\u7d44\u6210\u54e1"}), 403)
    return None


def fetch_todo_by_id(conn, todo_id):
    return conn.execute("SELECT * FROM study_todos WHERE id = ?", (todo_id,)).fetchone()


def clear_other_focus_todos(conn, user_id, group_id, keep_todo_id=None):
    scope_sql, scope_params = checkin_scope_query(group_id)
    params = [user_id, *scope_params]
    extra_sql = ""
    if keep_todo_id is not None:
        extra_sql = " AND id != ?"
        params.append(keep_todo_id)
    conn.execute(
        f"""
        UPDATE study_todos
        SET is_focus = FALSE, updated_at = ?
        WHERE user_id = ? AND {scope_sql}{extra_sql}
        """,
        (now(), *params),
    )


def load_user_todos(user_id):
    group_id = normalize_optional_group_id(request.args.get("group_id"))
    conn = get_conn()
    error = validate_todo_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error

    scope_sql, scope_params = checkin_scope_query(group_id)
    today = today_date().isoformat()
    rows = conn.execute(
        f"""
        SELECT *
        FROM study_todos
        WHERE user_id = ?
          AND {scope_sql}
          AND (is_done = FALSE OR todo_date = ?)
        ORDER BY is_focus DESC,
                 is_done ASC,
                 CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC,
                 due_at ASC,
                 created_at ASC,
                 id ASC
        """,
        (user_id, *scope_params, today),
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "todos": [serialize_todo(row) for row in rows]})


@app.route("/api/users/<int:user_id>/todos", methods=["GET"])
def get_user_todos(user_id):
    return load_user_todos(user_id)


@app.route("/api/users/<int:user_id>/todos/today", methods=["GET"])
def get_today_todos(user_id):
    return load_user_todos(user_id)


@app.route("/api/users/<int:user_id>/todos", methods=["POST"])
def create_todo(user_id):
    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    group_id = normalize_optional_group_id(data.get("group_id"))
    due_at = parse_todo_due(data.get("due_at"))
    if not title:
        return jsonify({"success": False, "message": "\u8acb\u8f38\u5165\u4ee3\u8fa6\u5167\u5bb9"}), 400

    conn = get_conn()
    error = validate_todo_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error

    created_at = now()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO study_todos (
            user_id, group_id, title, is_done, is_focus, todo_date, due_at,
            source_type, source_id, notified_before_due, notified_on_due,
            notified_overdue, created_at, updated_at
        )
        VALUES (?, ?, ?, FALSE, FALSE, ?, ?, 'manual', NULL, FALSE, FALSE, FALSE, ?, ?)
        """,
        (user_id, group_id, title, today_date().isoformat(), due_at, created_at, created_at),
    )
    todo_id = cur.lastrowid
    conn.commit()
    todo = fetch_todo_by_id(conn, todo_id)
    conn.close()
    return jsonify({"success": True, "message": "\u5df2\u65b0\u589e\u4eca\u65e5\u4ee3\u8fa6", "todo": serialize_todo(todo)})


@app.route("/api/todos/<int:todo_id>", methods=["PATCH"])
def update_todo(todo_id):
    data = request.get_json() or {}
    conn = get_conn()
    todo = fetch_todo_by_id(conn, todo_id)
    if not todo:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u6b64\u4ee3\u8fa6"}), 404

    updates = []
    params = []
    updated_at = now()
    message = "\u4eca\u65e5\u4ee3\u8fa6\u5df2\u66f4\u65b0"

    if "title" in data:
        next_title = (data.get("title") or "").strip()
        if not next_title:
            conn.close()
            return jsonify({"success": False, "message": "\u8acb\u8f38\u5165\u4ee3\u8fa6\u5167\u5bb9"}), 400
        updates.append("title = ?")
        params.append(next_title)

    if "due_at" in data:
        updates.append("due_at = ?")
        params.append(parse_todo_due(data.get("due_at")))

    if "is_done" in data:
        next_done = bool(data.get("is_done"))
        updates.append("is_done = ?")
        params.append(next_done)
        if next_done:
            updates.append("completed_at = COALESCE(completed_at, ?)")
            params.append(updated_at)
            updates.append("is_focus = FALSE")
            message = "\u5df2\u5b8c\u6210\u4eca\u65e5\u4ee3\u8fa6"
        else:
            updates.append("completed_at = NULL")
            message = "\u5df2\u6062\u5fa9\u70ba\u672a\u5b8c\u6210"

    if "is_focus" in data:
        next_focus = bool(data.get("is_focus"))
        if next_focus:
            clear_other_focus_todos(conn, todo["user_id"], todo.get("group_id"), todo_id)
            message = "\u5df2\u8a2d\u70ba\u4eca\u65e5\u91cd\u9ede"
        else:
            message = "\u5df2\u53d6\u6d88\u4eca\u65e5\u91cd\u9ede"
        updates.append("is_focus = ?")
        params.append(next_focus)

    if not updates:
        conn.close()
        return jsonify({"success": False, "message": "\u6c92\u6709\u8981\u66f4\u65b0\u7684\u5167\u5bb9"}), 400

    updates.append("updated_at = ?")
    params.append(updated_at)
    params.append(todo_id)
    conn.execute(f"UPDATE study_todos SET {', '.join(updates)} WHERE id = ?", tuple(params))

    if "is_done" in data and bool(data.get("is_done")) and not bool(todo.get("is_done")) and todo.get("group_id"):
        user_name = get_user_name(conn, todo["user_id"])
        reason = f"{user_name}\u5b8c\u6210\u4eca\u65e5\u4ee3\u8fa6\uff1a{todo['title']}"
        conn.execute(
            "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
            (todo["group_id"], todo["user_id"], reason, "todo_completed", updated_at),
        )

    conn.commit()
    updated = fetch_todo_by_id(conn, todo_id)
    conn.close()
    return jsonify({"success": True, "message": message, "todo": serialize_todo(updated)})


@app.route("/api/todos/<int:todo_id>", methods=["DELETE"])
def delete_todo(todo_id):
    conn = get_conn()
    todo = conn.execute("SELECT id FROM study_todos WHERE id = ?", (todo_id,)).fetchone()
    if not todo:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u6b64\u4ee3\u8fa6"}), 404
    conn.execute("DELETE FROM study_todos WHERE id = ?", (todo_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "ok": True, "message": "\u5df2\u522a\u9664\u4eca\u65e5\u4ee3\u8fa6"})


@app.route("/api/users/<int:user_id>/todos/sync-tasks", methods=["POST"])
def sync_tasks_to_todos(user_id):
    group_id = normalize_optional_group_id(request.args.get("group_id"))
    if group_id is None:
        return jsonify({"success": False, "message": "\u8acb\u5148\u9078\u64c7\u5171\u8b80\u7fa4\u7d44"}), 400

    conn = get_conn()
    error = validate_todo_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error

    tasks = conn.execute(
        """
        SELECT id, title, due_date, deadline, is_completed
        FROM tasks
        WHERE group_id = ? AND assigned_to = ? AND COALESCE(is_completed, 0) = 0
        ORDER BY id ASC
        """,
        (group_id, user_id),
    ).fetchall()

    created = []
    created_at = now()
    for task in tasks:
        exists = conn.execute(
            """
            SELECT id FROM study_todos
            WHERE user_id = ? AND group_id = ? AND source_type = 'task' AND source_id = ?
            """,
            (user_id, group_id, task["id"]),
        ).fetchone()
        if exists:
            continue
        due_at = parse_todo_due(task.get("due_date") or task.get("deadline"))
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO study_todos (
                user_id, group_id, title, is_done, is_focus, todo_date, due_at,
                source_type, source_id, notified_before_due, notified_on_due,
                notified_overdue, created_at, updated_at
            )
            VALUES (?, ?, ?, FALSE, FALSE, ?, ?, 'task', ?, FALSE, FALSE, FALSE, ?, ?)
            """,
            (user_id, group_id, task["title"], today_date().isoformat(), due_at, task["id"], created_at, created_at),
        )
        created.append(cur.lastrowid)

    conn.commit()
    rows = []
    if created:
        placeholders = ", ".join(["?"] * len(created))
        rows = conn.execute(f"SELECT * FROM study_todos WHERE id IN ({placeholders}) ORDER BY id ASC", tuple(created)).fetchall()
    conn.close()
    return jsonify({
        "success": True,
        "message": "\u5df2\u540c\u6b65\u5206\u6d3e\u4efb\u52d9\u5230\u4eca\u65e5\u4ee3\u8fa6",
        "created_count": len(created),
        "todos": [serialize_todo(row) for row in rows],
    })


@app.route("/api/users/<int:user_id>/todos/check-reminders", methods=["POST"])
def check_todo_reminders(user_id):
    group_id = normalize_optional_group_id(request.args.get("group_id"))
    conn = get_conn()
    error = validate_todo_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    scope_sql, scope_params = checkin_scope_query(group_id)
    rows = conn.execute(
        f"""
        SELECT id, title, due_at
        FROM study_todos
        WHERE user_id = ? AND {scope_sql} AND is_done = FALSE AND due_at IS NOT NULL
        ORDER BY due_at ASC
        """,
        (user_id, *scope_params),
    ).fetchall()
    reminders = []
    now_dt = datetime.now()
    for row in rows:
        due_dt = todo_due_datetime(row.get("due_at"))
        if due_dt and due_dt < now_dt:
            reminders.append({"id": row["id"], "title": row["title"], "type": "overdue"})
    conn.close()
    return jsonify({"success": True, "reminders": reminders})

def validate_checkin_scope(conn, user_id, group_id):
    user = conn.execute("SELECT id, nickname, name, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return None, (jsonify({"success": False, "message": "找不到使用者"}), 404)
    if group_id is not None:
        group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not group:
            return None, (jsonify({"success": False, "message": "找不到群組"}), 404)
        if not is_group_member(conn, group_id, user_id):
            return None, (jsonify({"success": False, "message": "只有群組成員可以打卡"}), 403)
    return user, None


@app.route("/api/checkins", methods=["POST"])
def create_or_update_checkin():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    group_id = normalize_optional_group_id(data.get("group_id"))
    mood = (data.get("mood") or "").strip()
    note = (data.get("note") or "").strip()
    try:
        study_minutes = max(0, int(data.get("study_minutes") or 0))
    except (TypeError, ValueError):
        study_minutes = 0

    if not user_id:
        return jsonify({"success": False, "message": "找不到使用者"}), 400

    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error

    check_date = today_date()
    current = fetch_today_checkin(conn, user_id, group_id, check_date)
    created_at = now()
    earned_coins = 0

    if current:
        conn.execute(
            """
            UPDATE study_checkins
            SET mood = ?, note = ?, study_minutes = ?, updated_at = ?
            WHERE id = ?
            """,
            (mood, note, study_minutes, created_at, current["id"]),
        )
        checkin_id = current["id"]
        message = "今日打卡已更新"
    else:
        earned_coins = 5 + (5 if study_minutes >= 60 else 0)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO study_checkins (user_id, group_id, checkin_date, mood, note, study_minutes, earned_coins, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, group_id, check_date.isoformat(), mood, note, study_minutes, earned_coins, created_at, created_at),
        )
        checkin_id = cur.lastrowid
        current_coins = user["coins"] if user["coins"] is not None else user["coin"]
        next_coins = int(current_coins or 0) + earned_coins
        conn.execute("UPDATE users SET coins = ?, coin = ? WHERE id = ?", (next_coins, next_coins, user_id))
        nickname = user["nickname"] or user["name"] or "夥伴"
        if group_id is not None:
            if earned_coins:
                conn.execute("UPDATE groups SET total_coin = COALESCE(total_coin, 0) + ? WHERE id = ?", (earned_coins, group_id))
            reason = f"{nickname}完成今日讀書打卡，獲得 {earned_coins} 金幣。"
            conn.execute(
                "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (group_id, user_id, earned_coins, reason, "checkin", created_at),
            )
            create_notification(conn, group_id, "每日打卡", reason, "coin")
        message = f"今日打卡完成，獲得 {earned_coins} 金幣"

    row = conn.execute("SELECT * FROM study_checkins WHERE id = ?", (checkin_id,)).fetchone()
    streak_days = calculate_checkin_streak(conn, user_id, group_id, check_date)
    user_row = conn.execute("SELECT id, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "ok": True,
        "message": message,
        "checkin": serialize_checkin(row),
        "streak_days": streak_days,
        "has_checked_in_today": True,
        "earned_coins": earned_coins,
        "user_coins": user_row["coins"] if user_row else None,
    })


@app.route("/api/users/<int:user_id>/checkins/today", methods=["GET"])
def get_user_today_checkin(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    check_date = today_date()
    row = fetch_today_checkin(conn, user_id, group_id, check_date)
    streak_days = calculate_checkin_streak(conn, user_id, group_id, check_date)
    conn.close()
    return jsonify({
        "success": True,
        "has_checked_in_today": bool(row),
        "checkin": serialize_checkin(row),
        "streak_days": streak_days,
    })


@app.route("/api/users/<int:user_id>/checkins/streak", methods=["GET"])
def get_user_checkin_streak(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    streak_days = calculate_checkin_streak(conn, user_id, group_id)
    conn.close()
    return jsonify({"success": True, "streak_days": streak_days})


@app.route("/api/groups/<int:group_id>/checkins/today", methods=["GET"])
def get_group_today_checkins(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到群組"}), 404
    check_date = today_date().isoformat()
    rows = conn.execute(
        """
        SELECT users.id AS user_id,
               users.nickname,
               users.name,
               study_checkins.id AS checkin_id,
               study_checkins.mood,
               study_checkins.note,
               study_checkins.study_minutes,
               study_checkins.created_at AS checkin_time
        FROM group_members
        JOIN users ON group_members.user_id = users.id
        LEFT JOIN study_checkins
          ON study_checkins.user_id = users.id
         AND study_checkins.group_id = group_members.group_id
         AND study_checkins.checkin_date = ?
        WHERE group_members.group_id = ?
        ORDER BY group_members.id ASC
        """,
        (check_date, group_id),
    ).fetchall()
    result = []
    for row in rows:
        checkin_time = row.get("checkin_time")
        if hasattr(checkin_time, "isoformat"):
            checkin_time = checkin_time.isoformat()
        result.append({
            "user_id": row["user_id"],
            "display_name": row["nickname"] or row["name"] or "夥伴",
            "has_checked_in_today": bool(row.get("checkin_id")),
            "mood": row.get("mood"),
            "note": row.get("note"),
            "study_minutes": int(row.get("study_minutes") or 0),
            "checkin_time": checkin_time,
        })
    conn.close()
    return jsonify({"success": True, "checkins": result})


@app.route("/api/study-sessions", methods=["POST"])
def create_study_session():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    group_id = normalize_optional_group_id(data.get("group_id"))
    todo_id = normalize_optional_group_id(data.get("todo_id"))
    subject = (data.get("subject") or "").strip()
    start_time = parse_client_datetime(data.get("start_time"))
    end_time = parse_client_datetime(data.get("end_time"))

    if not user_id:
        return jsonify({"success": False, "message": "請先登入"}), 400
    if not start_time or not end_time:
        return jsonify({"success": False, "message": "讀書時間格式不正確"}), 400
    if end_time <= start_time:
        return jsonify({"success": False, "message": "讀書結束時間必須晚於開始時間"}), 400

    conn = get_conn()
    user = conn.execute("SELECT id, nickname, name, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "找不到使用者"}), 404

    if group_id is not None:
        if not conn.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone():
            conn.close()
            return jsonify({"success": False, "message": "找不到群組"}), 404
        if not is_group_member(conn, group_id, user_id):
            conn.close()
            return jsonify({"success": False, "message": "只有群組成員可以記錄群組讀書時間"}), 403

    if todo_id is not None:
        scope_sql, scope_params = checkin_scope_query(group_id)
        todo = conn.execute(
            f"""
            SELECT id, title
            FROM study_todos
            WHERE id = ? AND user_id = ? AND {scope_sql} AND is_done = FALSE
            """,
            (todo_id, user_id, *scope_params),
        ).fetchone()
        if not todo:
            conn.close()
            return jsonify({"success": False, "message": "找不到今日代辦"}), 404
        if not subject:
            subject = todo["title"]

    if not subject:
        conn.close()
        return jsonify({"success": False, "message": "請先選擇今日代辦"}), 400

    duration_seconds = max(0, int((end_time - start_time).total_seconds()))
    duration_minutes = duration_seconds // 60
    earned_coins = (duration_minutes // 10) * 5
    created_at = now()

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO study_sessions (
            user_id, group_id, todo_id, subject, start_time, end_time,
            duration_seconds, duration_minutes, earned_coins, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            group_id,
            todo_id,
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
    reason = f"{nickname}完成「{subject}」讀書 {duration_minutes} 分鐘，獲得 {earned_coins} 金幣。"
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
            "todo_id": todo_id,
            "subject": subject,
            "duration_seconds": duration_seconds,
            "duration_minutes": duration_minutes,
            "earned_coins": earned_coins,
            "user_coins": next_coins,
            "created_at": created_at,
        },
    }), 201


@app.route("/api/users/<int:user_id>/study-summary/today", methods=["GET"])
def get_today_study_summary(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    summary = study_summary(conn, user_id, group_id, "today")
    conn.close()
    return jsonify({
        "success": True,
        **summary,
        "today_study_minutes": int(summary.get("total_minutes") or 0),
    })


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



def last_seven_dates():
    today = datetime.now().date()
    return [today - timedelta(days=offset) for offset in range(6, -1, -1)]


def week_bounds():
    start, end = date_range("week")
    return start, end


def normalize_date_key(value):
    if not value:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    return str(value)[:10]


def group_scope_condition(group_id, table_alias=""):
    prefix = f"{table_alias}." if table_alias else ""
    if group_id is None:
        return f"{prefix}group_id IS NULL", ()
    return f"{prefix}group_id = ?", (group_id,)


def user_study_minutes_by_day(conn, user_id, group_id, dates):
    date_keys = [date.isoformat() for date in dates]
    result = {key: 0 for key in date_keys}
    start = datetime.combine(dates[0], datetime.min.time()).strftime("%Y-%m-%d %H:%M:%S")
    end = (datetime.combine(dates[-1], datetime.min.time()) + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    scope_sql, scope_params = group_scope_condition(group_id)
    session_rows = conn.execute(
        f"""
        SELECT DATE(start_time) AS study_date,
               COALESCE(SUM(duration_minutes), 0) AS minutes
        FROM study_sessions
        WHERE user_id = ? AND {scope_sql} AND start_time >= ? AND start_time < ?
        GROUP BY DATE(start_time)
        """,
        (user_id, *scope_params, start, end),
    ).fetchall()
    session_dates = set()
    for row in session_rows:
        key = normalize_date_key(row["study_date"])
        if key in result:
            result[key] = int(row["minutes"] or 0)
            session_dates.add(key)

    check_scope_sql, check_scope_params = group_scope_condition(group_id)
    checkin_rows = conn.execute(
        f"""
        SELECT checkin_date,
               COALESCE(study_minutes, 0) AS minutes
        FROM study_checkins
        WHERE user_id = ? AND {check_scope_sql} AND checkin_date >= ? AND checkin_date <= ?
        """,
        (user_id, *check_scope_params, date_keys[0], date_keys[-1]),
    ).fetchall()
    for row in checkin_rows:
        key = normalize_date_key(row["checkin_date"])
        if key in result and key not in session_dates:
            result[key] = int(row["minutes"] or 0)
    return [{"date": key, "minutes": result[key]} for key in date_keys]


def weekday_label(date_value):
    labels = ["一", "二", "三", "四", "五", "六", "日"]
    return labels[date_value.weekday()]


def user_checkin_week_rows(conn, user_id, group_id):
    dates = last_seven_dates()
    date_keys = [date.isoformat() for date in dates]
    scope_sql, scope_params = checkin_scope_query(group_id)
    rows = conn.execute(
        f"""
        SELECT checkin_date
        FROM study_checkins
        WHERE user_id = ? AND {scope_sql} AND checkin_date >= ? AND checkin_date <= ?
        """,
        (user_id, *scope_params, date_keys[0], date_keys[-1]),
    ).fetchall()
    checked_dates = {normalize_date_key(row["checkin_date"]) for row in rows}
    return [
        {
            "day": weekday_label(date),
            "date": date.isoformat(),
            "checked": date.isoformat() in checked_dates,
        }
        for date in dates
    ]


def serialize_task_timeline_rows(rows, fallback_start, fallback_end):
    today = datetime.now().date()
    result = []
    for row in rows:
        start_date = normalize_date_key(row.get("created_at")) or fallback_start
        end_date = normalize_date_key(row.get("due_date") or row.get("deadline")) or fallback_end
        completed_at = normalize_date_key(row.get("completed_at")) or None
        is_completed = int(row.get("is_completed") or 0) == 1 or row.get("status") in ("completed", "done", "已完成")
        status = "completed" if is_completed else "in_progress"
        try:
            if not is_completed and datetime.strptime(end_date, "%Y-%m-%d").date() < today:
                status = "overdue"
        except ValueError:
            pass
        result.append({
            "task_id": row["task_id"],
            "title": row["title"],
            "assignee_name": row.get("assignee_name") or row.get("assignee_fallback") or "未指派",
            "start_date": start_date,
            "end_date": end_date,
            "completed_at": completed_at,
            "status": status,
        })
    return result


@app.route("/api/users/<int:user_id>/stats/summary")
def get_user_stats_summary(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    today_summary = study_summary(conn, user_id, group_id, "today")
    week_summary = study_summary(conn, user_id, group_id, "week")
    start, end = week_bounds()
    if group_id is None:
        task_row = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM tasks
            WHERE assigned_to = ? AND is_completed = 1 AND completed_at >= ? AND completed_at < ?
            """,
            (user_id, start, end),
        ).fetchone()
    else:
        task_row = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM tasks
            WHERE assigned_to = ? AND group_id = ? AND is_completed = 1 AND completed_at >= ? AND completed_at < ?
            """,
            (user_id, group_id, start, end),
        ).fetchone()
    coin_scope_sql, coin_scope_params = group_scope_condition(group_id)
    coin_row = conn.execute(
        f"""
        SELECT COALESCE(SUM(amount), 0) AS earned
        FROM coin_history
        WHERE user_id = ? AND {coin_scope_sql} AND amount > 0 AND created_at >= ? AND created_at < ?
        """,
        (user_id, *coin_scope_params, start, end),
    ).fetchone()
    checkin_scope_sql, checkin_scope_params = checkin_scope_query(group_id)
    checkin_row = conn.execute(
        f"""
        SELECT COUNT(*) AS c
        FROM study_checkins
        WHERE user_id = ? AND {checkin_scope_sql} AND checkin_date >= ? AND checkin_date <= ?
        """,
        (
            user_id,
            *checkin_scope_params,
            start[:10],
            (datetime.strptime(end, "%Y-%m-%d %H:%M:%S").date() - timedelta(days=1)).isoformat(),
        ),
    ).fetchone()
    today_checkin = fetch_today_checkin(conn, user_id, group_id, today_date())
    coins = user["coins"] if user["coins"] is not None else user["coin"]
    streak_days = calculate_checkin_streak(conn, user_id, group_id)
    conn.close()
    return jsonify({
        "success": True,
        "today_study_minutes": int(today_summary["total_minutes"] or 0),
        "week_study_minutes": int(week_summary["total_minutes"] or 0),
        "week_completed_tasks": int(task_row["c"] or 0),
        "week_earned_coins": int(coin_row["earned"] or 0),
        "week_checkin_days": int(checkin_row["c"] or 0),
        "has_checked_in_today": bool(today_checkin),
        "coins": int(coins or 0),
        "streak_days": int(streak_days or 0),
    })


@app.route("/api/users/<int:user_id>/stats/study-week")
def get_user_study_week_stats(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    rows = user_study_minutes_by_day(conn, user_id, group_id, last_seven_dates())
    conn.close()
    return jsonify({"success": True, "days": rows})


@app.route("/api/users/<int:user_id>/stats/study-timeline-today", methods=["GET"])
def get_user_today_study_timeline(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error

    today = datetime.now().date()
    start = datetime.combine(today, datetime.min.time()).strftime("%Y-%m-%d %H:%M:%S")
    end = (datetime.combine(today, datetime.min.time()) + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    scope_sql, scope_params = group_scope_condition(group_id)
    rows = conn.execute(
        f"""
        SELECT id,
               subject,
               start_time,
               end_time,
               COALESCE(duration_minutes, FLOOR(duration_seconds / 60)) AS duration_minutes
        FROM study_sessions
        WHERE user_id = ? AND {scope_sql} AND start_time >= ? AND start_time < ?
        ORDER BY start_time ASC, id ASC
        """,
        (user_id, *scope_params, start, end),
    ).fetchall()

    sessions = []
    for row in rows:
        start_dt = row["start_time"]
        end_dt = row["end_time"]
        if isinstance(start_dt, str):
            start_dt = datetime.fromisoformat(start_dt.replace("Z", "+00:00")).replace(tzinfo=None)
        if isinstance(end_dt, str):
            end_dt = datetime.fromisoformat(end_dt.replace("Z", "+00:00")).replace(tzinfo=None)
        start_minutes = start_dt.hour * 60 + start_dt.minute
        end_minutes = end_dt.hour * 60 + end_dt.minute
        if end_minutes <= start_minutes:
            end_minutes = min(1440, start_minutes + int(row["duration_minutes"] or 0))
        duration_minutes = int(row["duration_minutes"] or max(0, end_minutes - start_minutes))
        sessions.append({
            "id": row["id"],
            "subject": row.get("subject") or "??",
            "start_time": start_dt.strftime("%H:%M"),
            "end_time": end_dt.strftime("%H:%M"),
            "start_minutes": start_minutes,
            "end_minutes": min(1440, end_minutes),
            "duration_minutes": duration_minutes,
        })

    conn.close()
    return jsonify({"success": True, "sessions": sessions})


@app.route("/api/users/<int:user_id>/stats/coins")
def get_user_coin_stats(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user = conn.execute("SELECT id, coins, coin FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u4f7f\u7528\u8005"}), 404
    if group_id is not None and not is_group_member(conn, group_id, user_id):
        conn.close()
        return jsonify({"success": False, "message": "只有群組成員可以查看此統計"}), 403
    current_coins = int((user["coins"] if user["coins"] is not None else user["coin"]) or 0)
    coin_scope_sql, coin_scope_params = group_scope_condition(group_id)
    rows = conn.execute(
        f"""
        SELECT amount, created_at
        FROM coin_history
        WHERE user_id = ? AND {coin_scope_sql}
        ORDER BY created_at DESC, id DESC
        LIMIT 10
        """,
        (user_id, *coin_scope_params),
    ).fetchall()
    ordered = list(reversed(rows))
    total_delta = sum(int(row["amount"] or 0) for row in ordered)
    running = current_coins - total_delta
    points = []
    for row in ordered:
        running += int(row["amount"] or 0)
        points.append({"date": normalize_date_key(row["created_at"]), "coins": running})
    if not points:
        points = [{"date": datetime.now().date().isoformat(), "coins": current_coins}]
    conn.close()
    return jsonify({"success": True, "points": points})


@app.route("/api/users/<int:user_id>/stats/checkin-week")
def get_user_checkin_week_stats(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    rows = user_checkin_week_rows(conn, user_id, group_id)
    conn.close()
    return jsonify({"success": True, "days": rows})


@app.route("/api/users/<int:user_id>/stats/task-timeline")
def get_user_task_timeline(user_id):
    group_id = parse_optional_group_id()
    conn = get_conn()
    user, error = validate_checkin_scope(conn, user_id, group_id)
    if error:
        conn.close()
        return error
    start, end = week_bounds()
    if group_id is None:
        rows = conn.execute(
            """
            SELECT tasks.id AS task_id,
                   tasks.title,
                   tasks.created_at,
                   tasks.due_date,
                   tasks.deadline,
                   tasks.completed_at,
                   tasks.is_completed,
                   tasks.status,
                   users.nickname AS assignee_name,
                   users.name AS assignee_fallback
            FROM tasks
            LEFT JOIN users ON tasks.assigned_to = users.id
            WHERE tasks.assigned_to = ?
            ORDER BY tasks.is_completed ASC, tasks.created_at ASC, tasks.id ASC
            LIMIT 20
            """,
            (user_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT tasks.id AS task_id,
                   tasks.title,
                   tasks.created_at,
                   tasks.due_date,
                   tasks.deadline,
                   tasks.completed_at,
                   tasks.is_completed,
                   tasks.status,
                   users.nickname AS assignee_name,
                   users.name AS assignee_fallback
            FROM tasks
            LEFT JOIN users ON tasks.assigned_to = users.id
            WHERE tasks.assigned_to = ? AND tasks.group_id = ?
            ORDER BY tasks.is_completed ASC, tasks.created_at ASC, tasks.id ASC
            LIMIT 20
            """,
            (user_id, group_id),
        ).fetchall()
    fallback_start = start[:10]
    fallback_end = (datetime.now().date() + timedelta(days=1)).isoformat()
    result = serialize_task_timeline_rows(rows, fallback_start, fallback_end)
    conn.close()
    return jsonify({"success": True, "tasks": result})


@app.route("/api/groups/<int:group_id>/stats/summary")
def get_group_stats_summary(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u7fa4\u7d44"}), 404
    start, end = week_bounds()
    task_row = conn.execute(
        """
        SELECT COUNT(*) AS total_tasks,
               SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed_tasks
        FROM tasks
        WHERE group_id = ? AND created_at >= ? AND created_at < ?
        """,
        (group_id, start, end),
    ).fetchone()
    coin_row = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS earned
        FROM coin_history
        WHERE group_id = ? AND amount > 0 AND created_at >= ? AND created_at < ?
        """,
        (group_id, start, end),
    ).fetchone()
    checkin_row = conn.execute(
        """
        SELECT COUNT(*) AS c
        FROM study_checkins
        WHERE group_id = ? AND checkin_date >= ? AND checkin_date <= ?
        """,
        (
            group_id,
            start[:10],
            (datetime.strptime(end, "%Y-%m-%d %H:%M:%S").date() - timedelta(days=1)).isoformat(),
        ),
    ).fetchone()
    study_row = conn.execute(
        """
        SELECT COALESCE(SUM(duration_minutes), 0) AS minutes
        FROM study_sessions
        WHERE group_id = ? AND start_time >= ? AND start_time < ?
        """,
        (group_id, start, end),
    ).fetchone()
    member_count = conn.execute("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?", (group_id,)).fetchone()["c"]
    total = int(task_row["total_tasks"] or 0)
    completed = int(task_row["completed_tasks"] or 0)
    conn.close()
    return jsonify({
        "success": True,
        "week_total_tasks": total,
        "week_completed_tasks": completed,
        "completion_rate": round((completed / total) * 100) if total else 0,
        "week_study_minutes": int(study_row["minutes"] or 0),
        "week_earned_coins": int(coin_row["earned"] or 0),
        "week_checkin_days": int(checkin_row["c"] or 0),
        "member_count": int(member_count or 0),
    })


@app.route("/api/groups/<int:group_id>/stats/contributions")
def get_group_contribution_stats(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u7fa4\u7d44"}), 404
    start, end = week_bounds()
    rows = conn.execute(
        """
        SELECT users.id AS user_id,
               users.nickname,
               users.name,
               COALESCE(tasks_done.completed_tasks, 0) AS completed_tasks,
               COALESCE(study_done.study_minutes, 0) AS study_minutes,
               COALESCE(checkins_done.checkin_days, 0) AS checkin_days,
               COALESCE(coins_done.coins_earned, 0) AS coins_earned
        FROM group_members
        JOIN users ON group_members.user_id = users.id
        LEFT JOIN (
          SELECT assigned_to AS user_id, COUNT(*) AS completed_tasks
          FROM tasks
          WHERE group_id = ? AND is_completed = 1 AND completed_at >= ? AND completed_at < ?
          GROUP BY assigned_to
        ) AS tasks_done ON tasks_done.user_id = users.id
        LEFT JOIN (
          SELECT user_id, SUM(duration_minutes) AS study_minutes
          FROM study_sessions
          WHERE group_id = ? AND start_time >= ? AND start_time < ?
          GROUP BY user_id
        ) AS study_done ON study_done.user_id = users.id
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS checkin_days
          FROM study_checkins
          WHERE group_id = ? AND checkin_date >= ? AND checkin_date <= ?
          GROUP BY user_id
        ) AS checkins_done ON checkins_done.user_id = users.id
        LEFT JOIN (
          SELECT user_id, SUM(amount) AS coins_earned
          FROM coin_history
          WHERE group_id = ? AND created_at >= ? AND created_at < ?
          GROUP BY user_id
        ) AS coins_done ON coins_done.user_id = users.id
        WHERE group_members.group_id = ?
        ORDER BY group_members.id ASC
        """,
        (
            group_id, start, end,
            group_id, start, end,
            group_id, start[:10], (datetime.strptime(end, "%Y-%m-%d %H:%M:%S").date() - timedelta(days=1)).isoformat(),
            group_id, start, end,
            group_id,
        ),
    ).fetchall()
    result = []
    for row in rows:
        completed_tasks = int(row["completed_tasks"] or 0)
        study_minutes = int(row["study_minutes"] or 0)
        checkin_days = int(row["checkin_days"] or 0)
        result.append({
            "user_id": row["user_id"],
            "display_name": row["nickname"] or row["name"] or "\u5925\u4f34",
            "completed_tasks": completed_tasks,
            "study_minutes": study_minutes,
            "checkin_days": checkin_days,
            "coins_earned": int(row["coins_earned"] or 0),
            "contribution_score": completed_tasks * 100 + study_minutes + checkin_days * 20,
        })
    conn.close()
    return jsonify({"success": True, "contributions": result})


@app.route("/api/groups/<int:group_id>/stats/task-timeline")
def get_group_task_timeline(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "\u627e\u4e0d\u5230\u7fa4\u7d44"}), 404
    start, end = week_bounds()
    rows = conn.execute(
        """
        SELECT tasks.id AS task_id,
               tasks.title,
               tasks.created_at,
               tasks.due_date,
               tasks.deadline,
               tasks.completed_at,
               tasks.is_completed,
               tasks.status,
               users.nickname AS assignee_name,
               users.name AS assignee_fallback
        FROM tasks
        LEFT JOIN users ON tasks.assigned_to = users.id
        WHERE tasks.group_id = ?
        ORDER BY tasks.is_completed ASC, tasks.created_at ASC, tasks.id ASC
        LIMIT 20
        """,
        (group_id,),
    ).fetchall()
    fallback_start = start[:10]
    fallback_end = (datetime.now().date() + timedelta(days=1)).isoformat()
    result = serialize_task_timeline_rows(rows, fallback_start, fallback_end)
    conn.close()
    return jsonify({"success": True, "tasks": result})


@app.route("/api/groups/<int:group_id>/stats/checkin-week")
def get_group_checkin_week_stats(group_id):
    conn = get_conn()
    group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"success": False, "message": "找不到群組"}), 404
    dates = last_seven_dates()
    date_keys = [date.isoformat() for date in dates]
    member_count = conn.execute("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?", (group_id,)).fetchone()["c"]
    rows = conn.execute(
        """
        SELECT checkin_date, COUNT(DISTINCT user_id) AS checked_count
        FROM study_checkins
        WHERE group_id = ? AND checkin_date >= ? AND checkin_date <= ?
        GROUP BY checkin_date
        """,
        (group_id, date_keys[0], date_keys[-1]),
    ).fetchall()
    checked_map = {normalize_date_key(row["checkin_date"]): int(row["checked_count"] or 0) for row in rows}
    result = [
        {
            "day": weekday_label(date),
            "date": date.isoformat(),
            "checked_count": checked_map.get(date.isoformat(), 0),
            "member_count": int(member_count or 0),
            "checked": bool(checked_map.get(date.isoformat(), 0)),
        }
        for date in dates
    ]
    conn.close()
    return jsonify({"success": True, "days": result})


@app.route("/api/rewards/<int:group_id>")
def get_rewards(group_id):
    return jsonify([])


@app.route("/api/rewards/exchange", methods=["POST"])
def exchange_reward():
    return jsonify({"error": "固定商品兌換已停用，請使用國庫卡牌池。"}), 410


if __name__ == "__main__":
    ensure_db_initialized()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
