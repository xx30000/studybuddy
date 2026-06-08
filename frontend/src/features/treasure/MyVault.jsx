import React from 'react';
import { api } from '../../lib/api.js';

export default function MyVault({ cards, refresh, setToast }) {
  async function useCard(card) {
    await api(`/user-reward-cards/${card.id}/use`, { method: 'PUT' });
    setToast(`已使用「${card.title}」`);
    refresh();
  }

  return (
    <div className="page-stack">
      <section className="white-card treasury-head my-vault-head">
        <h2>我的寶庫</h2>
        <p>這裡會收藏你完成任務後抽到的獎勵卡牌。</p>
      </section>

      <section className="white-card">
        <div className="section-title pink"><span />我的獎勵卡</div>
        <div className="reward-card-grid">
          {cards.map((card) => (
            <article className={`reward-card my-card ${card.status === 'used' ? 'used' : ''}`} key={card.id}>
              <div className="reward-card-head">
                <h3>{card.title}</h3>
                <span className={`rarity-tag rarity-${card.rarity}`}>{card.rarity}</span>
              </div>
              <p>{card.description || '沒有卡牌說明'}</p>
              <div className="card-meta">
                <span>{card.category}</span>
                <span>{card.status === 'used' ? '已使用' : '未使用'}</span>
              </div>
              <small>來源任務：{card.source_task_title || '未記錄'}</small>
              <small>獲得時間：{card.obtained_at}</small>
              {card.used_at && <small>使用時間：{card.used_at}</small>}
              {card.status !== 'used' && (
                <button className="primary-btn compact card-use-btn" onClick={() => useCard(card)}>
                  使用
                </button>
              )}
            </article>
          ))}
          {!cards.length && <p className="empty-text">目前還沒有抽到任何獎勵卡</p>}
        </div>
      </section>
    </div>
  );
}
