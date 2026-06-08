import React, { useState } from 'react';
import { KeyRound, LogOut, NotebookPen } from 'lucide-react';

export default function JoinCastle({ user, onJoinGroup, onLogout }) {
  const [passcode, setPasscode] = useState('studymeal');

  function submit(e) {
    e.preventDefault();
    onJoinGroup(passcode);
  }

  return (
    <section className="login-castle-card join-castle-card">
      <button className="plain-logout" onClick={onLogout}><LogOut size={16} /> 登出</button>
      <div className="logo-circle small-logo study-logo">
        <NotebookPen size={48} />
        <span className="mini-crown">✓</span>
      </div>
      <h1>加入共讀小隊</h1>
      <p className="subtitle">歡迎 {user.nickname || user.name}，輸入群組通行碼後就能和夥伴一起分派專題任務。</p>
      <form onSubmit={submit} className="castle-form">
        <label>群組通行碼</label>
        <input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="請輸入通行碼" />
        <button className="primary-btn" type="submit"><KeyRound size={18} /> 加入群組</button>
        <small>預設通行碼是 studymeal</small>
      </form>
    </section>
  );
}
