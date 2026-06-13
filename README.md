# StudyBuddy

React + Flask + PostgreSQL 的共讀專案。

## 部署架構

- Frontend：Vercel
- Backend：Render Free Web Service
- Database：Supabase PostgreSQL

本專案部署時使用 PostgreSQL。請不要使用 SQLite、Render PostgreSQL，或把資料庫帳密寫死在程式碼裡。

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

注意：`VITE_API_BASE_URL` 請填 Render 後端網址，不要加 `/api`。

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
DATABASE_URL=Supabase PostgreSQL connection string
FRONTEND_URL=Vercel 前端網址
```

注意：

- `DATABASE_URL` 請使用 Supabase 的 PostgreSQL URI connection string。
- 不要把 Supabase anon key 當成 `DATABASE_URL`。
- 不要把 Supabase service_role key 當成 `DATABASE_URL`。
- `DATABASE_URL` 應該是 `postgresql://` 開頭的資料庫連線字串。
- 如果 connection string 是 `postgres://` 開頭，後端會自動轉成 `postgresql://`。
- 不要把 `.env` 上傳到 GitHub。
- Render 會自動提供 `PORT`，`backend/app.py` 已支援 `PORT` 啟動。

## Database：Supabase PostgreSQL

Supabase 設定：

1. 到 `supabase.com` 建立 Project。
2. 設定 database password。
3. 到 Project Settings → Database → Connection string。
4. 複製 PostgreSQL URI connection string。
5. 把 connection string 貼到 Render 的 `DATABASE_URL`。

Render Flask Web Service 可以優先使用 Supabase 的 PostgreSQL URI connection string。請不要使用 Supabase API key 作為資料庫連線字串。

資料表會由 Flask 啟動時的 `init_db()` 自動建立，不會 DROP TABLE、清空資料或刪除全部資料。

## 部署完成後的網址關係

真正要打開給使用者的是 Vercel 前端網址，不是 Render 後端網址，也不是 Supabase 網址。

```text
Vercel 前端
↓
VITE_API_BASE_URL 呼叫 Render 後端
↓
Render 後端透過 DATABASE_URL 連到 Supabase PostgreSQL
```

## 本機開發

Backend：

```bash
cd backend
pip install -r requirements.txt
set DATABASE_URL=你的 Supabase PostgreSQL connection string
python app.py
```

macOS / Linux：

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL="你的 Supabase PostgreSQL connection string"
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
- `.DS_Store`
