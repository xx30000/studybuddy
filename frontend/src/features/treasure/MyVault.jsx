import React from 'react';
import { api } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

function iconSrc(iconKey) {
  return `/images/icons-transparent/${iconKey || 'star.png'}`;
}

export default function MyVault({ cards, refresh, setToast }) {
  async function useCard(card) {
    await api(`/user-reward-cards/${card.id}/use`, { method: 'PUT' });
    setToast(`已使用「${card.title}」`, 'success');
    refresh();
  }

  return (
    <div className="page-stack">
      <section className="white-card treasury-head my-vault-head treasury-section home-card">
        <h2 className="hero-title-row vault-page-title"><UiIcon name="bag" className="title-icon" />我的寶庫</h2>
        <p>這裡收藏你抽到的獎勵卡，需要時就可以使用。</p>
      </section>

      <section className="white-card treasury-section home-card">
        <div className="section-title pink vault-page-title"><span /><UiIcon name="star" className="section-icon" />我的獎勵卡</div>
        <div className="reward-card-grid">
          {cards.map((card) => (
            <article className={`reward-card my-card ${card.status === 'used' ? 'used' : ''}`} key={card.id}>
              <div className="reward-card-content">
                <img src={iconSrc(card.icon_key)} alt="" className="card-icon" />
                <div className="reward-card-main">
                  <div className="reward-card-head">
                    <h3 className="vault-card-title reward-card-title">{card.title}</h3>
                    <span className={`rarity-tag rarity-${card.rarity}`}>{card.rarity}</span>
                  </div>
                  <p className="vault-card-description reward-card-description">{card.description || '沒有卡牌說明'}</p>
                  <div className="card-meta vault-card-meta reward-card-meta">
                    <span className="icon-meta"><UiIcon name="bag" /> {card.category}</span>
                    <span className="icon-meta"><UiIcon name={card.status === 'used' ? 'check' : 'star'} /> {card.status === 'used' ? '已使用' : '可使用'}</span>
                  </div>
                  <small className="icon-meta vault-card-meta reward-card-meta"><UiIcon name="star" /> 來源：{card.source_task_title || '抽卡獎勵'}</small>
                  <small className="vault-card-meta reward-card-meta">取得時間：{card.obtained_at}</small>
                  {card.used_at && <small className="vault-card-meta reward-card-meta">使用時間：{card.used_at}</small>}
                  {card.status !== 'used' && (
                    <button className="primary-btn compact card-use-btn task-action-button" type="button" onClick={() => useCard(card)}>
                      <UiIcon name="heart" /> 使用
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!cards.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="bag" className="empty-icon" />
              <p>目前還沒有獎勵卡，可以到國庫抽卡試試手氣。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
