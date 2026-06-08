# StudyMeal 共讀餐桌：React + Flask + SQLite

這是一個「多人群組一起做專題任務 + 分享早餐午餐晚餐甜點飲料」的初版專案。

## 技術架構

- 前端：React + Vite
- 後端：Flask
- 資料庫：SQLite
- API：RESTful API

## 專案功能

- 群組通關密語登入
- 多個朋友共用同一個群組
- 新增專題任務、指派成員、設定金幣獎勵
- 完成任務後自動增加群組金幣與個人金幣
- 新增早餐、午餐、晚餐、甜點、飲料紀錄
- 群組寶庫兌換獎勵
- 金幣歷程紀錄

## 預設登入資料

- 暱稱：小雯 / 阿澤 / 小狗，或輸入新名字也可以
- 群組通關密語：`studymeal`

## 後端啟動方式

```bash
cd backend
python -m venv venv

# Windows PowerShell
venv\Scripts\activate

# macOS / Linux
# source venv/bin/activate

pip install -r requirements.txt
python app.py
```

後端預設會跑在：

```text
http://localhost:5000
```

第一次執行會自動建立 `studymeal.db`，並放入初始資料。

## 前端啟動方式

另外開一個終端機：

```bash
cd frontend
npm install
npm run dev
```

前端預設會跑在：

```text
http://localhost:5173
```

## 專題報告可用說法

本系統前端採用 React 建立互動式介面，包含群組登入、專題任務、飲食紀錄、群組寶庫與金幣歷程等頁面。後端採用 Flask 建立 RESTful API，負責處理群組資料、任務資料、飲食紀錄與金幣異動。資料庫使用 SQLite，方便開發與展示，後續可擴充為 MySQL 以支援更多使用者與長期資料保存。
