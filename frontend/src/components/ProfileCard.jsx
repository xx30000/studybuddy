import React from 'react';
import { Coins, LogOut, NotebookPen } from 'lucide-react';

export default function ProfileCard({ session, groupInfo, onLogout }) {
  const currentMember = groupInfo?.members?.find((member) => String(member.id) === String(session.user.id));
  const userCoins = currentMember?.coins ?? currentMember?.coin ?? session.user.coins ?? session.user.coin ?? 0;
  const groupCoins = groupInfo?.group?.total_coin ?? session.group?.total_coin ?? 0;
  const nickname = currentMember?.nickname || currentMember?.name || session.user.nickname || session.user.name;

  return (
    <section className="profile-royal-card">
      <div className="crown-icon"><NotebookPen size={28} /></div>
      <div className="profile-text">
        <h2>{nickname} 的任務筆記</h2>
        <p><Coins size={17} /> 個人 {userCoins} 金幣 · 小隊 {groupCoins} 金幣</p>
      </div>
      <button onClick={onLogout}><LogOut size={16} /> 登出</button>
    </section>
  );
}
