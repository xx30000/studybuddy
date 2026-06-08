from datetime import datetime
from pathlib import Path
import random
import sqlite3

from flask import Flask, jsonify, request
from flask_cors import CORS


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "studymeal.db"

app = Flask(__name__)
CORS(app)

TASK_REWARDS = [20, 25, 30, 35, 40, 45, 50]
DRAW_COST = 50
RARITY_WEIGHTS = {
    "普通": 60,
    "稀有": 25,
    "史詩": 10,
    "傳說": 5,
}


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def table_columns(conn, table):
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


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
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            passcode TEXT NOT NULL,
            total_coin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            avatar TEXT DEFAULT 'book',
            coin INTEGER DEFAULT 0,
            nickname TEXT,
            email TEXT,
            password TEXT,
            coins INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'project',
            assigned_to INTEGER,
            reward INTEGER DEFAULT 20,
            status TEXT DEFAULT 'pending',
            deadline TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT DEFAULT '',
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(assigned_to) REFERENCES users(id),
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS coin_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            cost INTEGER NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id)
        );

        CREATE TABLE IF NOT EXISTS reward_exchanges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT NOT NULL,
            rarity TEXT NOT NULL,
            weight INTEGER DEFAULT 60,
            created_by INTEGER,
            status TEXT DEFAULT 'pending',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS reward_card_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reward_card_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            approved_at TEXT NOT NULL,
            FOREIGN KEY(reward_card_id) REFERENCES reward_cards(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS user_reward_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    ensure_unique_user_fields(conn)

    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique ON users(nickname)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)")

    group_count = cur.execute("SELECT COUNT(*) AS c FROM groups").fetchone()["c"]
    if group_count == 0:
        cur.execute(
            "INSERT INTO groups (name, passcode, total_coin, created_at) VALUES (?, ?, ?, ?)",
            ("期末專題共讀小隊", "studymeal", 0, now()),
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
                "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)",
                (group_id, user_id, role),
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
                INSERT INTO reward_cards (group_id, title, description, category, rarity, weight, created_by, status, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, 'active', 1, ?)
                """,
                (group["id"], title, description, category, rarity, weight, now()),
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


def approval_counts(conn, card):
    members = group_member_ids(conn, card["group_id"])
    required = len([uid for uid in members if uid != card["created_by"]])
    approved = conn.execute(
        "SELECT COUNT(*) AS c FROM reward_card_approvals WHERE reward_card_id = ?",
        (card["id"],),
    ).fetchone()["c"]
    return approved, required


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "message": "StudyTogether API is running"})


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


@app.route("/api/groups/join", methods=["POST"])
def join_group():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    passcode = (data.get("passcode") or "").strip()
    if not user_id or not passcode:
        return jsonify({"error": "請輸入群組通行碼"}), 400

    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "找不到使用者"}), 404

    group = conn.execute("SELECT * FROM groups WHERE passcode = ?", (passcode,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"error": "群組通行碼錯誤"}), 401

    member = conn.execute(
        "SELECT * FROM group_members WHERE group_id = ? AND user_id = ?",
        (group["id"], user_id),
    ).fetchone()
    if not member:
        conn.execute(
            "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
            (group["id"], user_id),
        )
        conn.commit()

    result = {"group": dict(group), "user": normalize_user_row(user)}
    conn.close()
    return jsonify(result)


@app.route("/api/group/<int:group_id>")
def get_group(group_id):
    conn = get_conn()
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        return jsonify({"error": "找不到群組"}), 404

    members = conn.execute(
        """
        SELECT users.id, users.nickname AS name, users.nickname, users.email, users.avatar,
               users.coins AS coin, users.coins, group_members.role
        FROM group_members JOIN users ON group_members.user_id = users.id
        WHERE group_members.group_id = ?
        """,
        (group_id,),
    ).fetchall()
    conn.close()
    return jsonify({"group": dict(group), "members": rows_to_dicts(members)})


@app.route("/api/tasks/<int:group_id>")
def get_tasks(group_id):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT tasks.*, users.nickname AS assigned_name, users.avatar AS assigned_avatar
        FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
        WHERE tasks.group_id = ? ORDER BY tasks.id DESC
        """,
        (group_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json() or {}
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO tasks (group_id, title, description, category, assigned_to, reward, status, deadline, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data.get("group_id"),
            data.get("title"),
            data.get("description", ""),
            data.get("category", "project"),
            data.get("assigned_to"),
            random.choice(TASK_REWARDS),
            data.get("status", "pending"),
            data.get("deadline", ""),
            data.get("created_by"),
            now(),
        ),
    )
    conn.commit()
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(task)), 201


@app.route("/api/tasks/<int:task_id>/complete", methods=["PUT"])
def complete_task(task_id):
    data = request.get_json() or {}
    completed_by = data.get("user_id")
    conn = get_conn()
    task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task:
        conn.close()
        return jsonify({"error": "找不到任務"}), 404
    if task["status"] in ("completed", "done", "已完成"):
        conn.close()
        return jsonify({"error": "任務已完成"}), 400

    user_id = completed_by or task["assigned_to"]
    reward = int(task["reward"] or 0)
    completed_at = now()

    conn.execute("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", (completed_at, task_id))
    if user_id:
        conn.execute("UPDATE users SET coins = coins + ?, coin = coin + ? WHERE id = ?", (reward, reward, user_id))
    conn.execute("UPDATE groups SET total_coin = total_coin + ? WHERE id = ?", (reward, task["group_id"]))

    username = get_user_name(conn, user_id)
    reason = f"{username}完成「{task['title']}」，獲得 {reward} 金幣。"
    conn.execute(
        "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task["group_id"], user_id, reward, reason, "任務完成", completed_at),
    )
    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "message": "任務完成",
        "coins_added": reward,
    })


@app.route("/api/groups/<int:group_id>/reward-cards", methods=["GET", "POST"])
def group_reward_cards(group_id):
    conn = get_conn()
    if request.method == "GET":
        current_user_id = request.args.get("user_id", type=int)
        rows = conn.execute(
            """
            SELECT reward_cards.*, users.nickname AS creator_name
            FROM reward_cards LEFT JOIN users ON reward_cards.created_by = users.id
            WHERE reward_cards.group_id = ?
            ORDER BY reward_cards.id DESC
            """,
            (group_id,),
        ).fetchall()
        cards = []
        for row in rows:
            card = dict(row)
            approved, required = approval_counts(conn, row)
            card["approval_count"] = approved
            card["required_approvals"] = required
            card["current_user_approved"] = False
            if current_user_id:
                card["current_user_approved"] = bool(conn.execute(
                    "SELECT 1 FROM reward_card_approvals WHERE reward_card_id = ? AND user_id = ?",
                    (row["id"], current_user_id),
                ).fetchone())
            cards.append(card)
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

    member_ids = group_member_ids(conn, group_id)
    required_approvals = len([uid for uid in member_ids if uid != created_by])
    status = "active" if required_approvals == 0 else "pending"
    is_active = 1 if status == "active" else 0
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO reward_cards (group_id, title, description, category, rarity, weight, created_by, status, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (group_id, title, description, category, rarity, weight, created_by, status, is_active, now()),
    )
    if status == "active":
        conn.execute(
            "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
            (group_id, created_by, f"「{title}」已加入國庫卡牌池。", "卡牌啟用", now()),
        )
    conn.commit()
    row = conn.execute(
        """
        SELECT reward_cards.*, users.nickname AS creator_name
        FROM reward_cards LEFT JOIN users ON reward_cards.created_by = users.id
        WHERE reward_cards.id = ?
        """,
        (cur.lastrowid,),
    ).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.route("/api/reward-cards/<int:card_id>/approve", methods=["POST"])
def approve_reward_card(card_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_conn()
    card = conn.execute("SELECT * FROM reward_cards WHERE id = ?", (card_id,)).fetchone()
    if not card:
        conn.close()
        return jsonify({"success": False, "message": "找不到卡牌"}), 404
    if user_id == card["created_by"]:
        conn.close()
        return jsonify({"success": False, "message": "建立者不需要同意自己的卡牌"}), 400
    if user_id not in group_member_ids(conn, card["group_id"]):
        conn.close()
        return jsonify({"success": False, "message": "你不是此群組成員"}), 403
    if conn.execute(
        "SELECT 1 FROM reward_card_approvals WHERE reward_card_id = ? AND user_id = ?",
        (card_id, user_id),
    ).fetchone():
        conn.close()
        return jsonify({"success": False, "message": "你已經同意過這張卡牌"}), 400

    approved_at = now()
    conn.execute(
        "INSERT INTO reward_card_approvals (reward_card_id, user_id, approved_at) VALUES (?, ?, ?)",
        (card_id, user_id, approved_at),
    )
    approved, required = approval_counts(conn, card)
    card_status = card["status"]
    message = "已同意此卡牌，等待其他成員同意"
    if approved >= required:
        card_status = "active"
        conn.execute("UPDATE reward_cards SET status = 'active', is_active = 1 WHERE id = ?", (card_id,))
        conn.execute(
            "INSERT INTO coin_history (group_id, user_id, amount, reason, type, created_at) VALUES (?, ?, 0, ?, ?, ?)",
            (card["group_id"], user_id, f"「{card['title']}」已通過全員同意，加入國庫卡牌池。", "卡牌啟用", approved_at),
        )
        message = "全員已同意，卡牌已加入國庫卡牌池"
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": message, "card_status": card_status})


@app.route("/api/groups/<int:group_id>/draw-card", methods=["POST"])
def draw_card(group_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_conn()
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
        },
    })


@app.route("/api/users/<int:user_id>/reward-cards")
def user_reward_cards(user_id):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT user_reward_cards.*, reward_cards.title, reward_cards.description,
               reward_cards.category, reward_cards.rarity, reward_cards.weight,
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


@app.route("/api/rewards/<int:group_id>")
def get_rewards(group_id):
    return jsonify([])


@app.route("/api/rewards/exchange", methods=["POST"])
def exchange_reward():
    return jsonify({"error": "固定商品兌換已停用，請使用國庫卡牌池。"}), 410


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
