# StudyBuddy

React + Flask + PostgreSQL 的共讀專案。

## 部署架構

- Frontend：Vercel
- Backend：Render Free Web Service
- Database：Neon Free PostgreSQL

本專案部署時只使用 PostgreSQL。請不要使用 SQLite，也不要把資料庫帳密寫死在程式碼裡。

## Frontend：Vercel

Vercel 專案設定：

- Root Directory：`frontend`
- Build Command：`npm install && npm run build`
- Output Directory：`dist`

Environment Variables：

```text
VITE_API_BASE_URL=https://你的-render-backend.onrender.com
```

前端 API 會自動呼叫：

```text
${VITE_API_BASE_URL}/api/...
```

本機開發時如果沒有設定 `VITE_API_BASE_URL`，預設會使用：

```text
http://localhost:5000
```

## Backend：Render

Render Web Service 設定：

- Root Directory：`backend`
- Build Command：`pip install -r requirements.txt`
- Start Command：`gunicorn app:app`

Environment Variables：

```text
DATABASE_URL=Neon PostgreSQL 連線字串
FRONTEND_URL=Vercel 前端網址
```

注意：

- `DATABASE_URL` 請使用 Neon 提供的 PostgreSQL connection string。
- 如果 connection string 是 `postgres://` 開頭，後端會自動轉成 `postgresql://`。
- 不要把 `.env` 上傳到 GitHub。
- Render 會自動提供 `PORT`，`backend/app.py` 已支援 `PORT` 啟動。

## Database：Neon PostgreSQL

1. 到 Neon 建立 PostgreSQL project。
2. 複製 connection string。
3. 到 Render 的 Environment Variables 新增：

```text
DATABASE_URL=你的 Neon connection string
```

資料表會由 Flask 啟動時的 `init_db()` 自動建立。

## 本機開發

Backend：

```bash
cd backend
pip install -r requirements.txt
set DATABASE_URL=你的 Neon connection string
python app.py
```

macOS / Linux：

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL="你的 Neon connection string"
python app.py
```

Frontend：

```bash
cd frontend
npm install
npm run dev
```

如果前端需要指定後端網址，請在本機環境設定：

```text
VITE_API_BASE_URL=http://localhost:5000
```

## Git 注意事項

以下檔案不應上傳：

- `.env`
- `backend/.env`
- `frontend/.env`
- `node_modules`
- `frontend/node_modules`
- `dist`
- `frontend/dist`
- `__pycache__`
- `*.pyc`
