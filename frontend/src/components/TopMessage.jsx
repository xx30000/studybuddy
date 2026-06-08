import React from 'react';
import { Sparkles } from 'lucide-react';

export default function TopMessage() {
  return (
    <section className="royal-message">
      <div className="message-doodle"><Sparkles size={22} /></div>
      <div>
        <b>共讀進度提醒</b>
        <h2>完成任務後，系統會把金幣加入小隊寶庫。</h2>
        <p>一起分工、一起打勾，把專題慢慢推進。</p>
      </div>
    </section>
  );
}
