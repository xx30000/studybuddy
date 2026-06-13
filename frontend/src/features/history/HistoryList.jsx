import React from 'react';
import { UiIcon, historyIconMap } from '../../lib/icons.js';

function historyIcon(item) {
  const text = `${item.type || ''} ${item.reason || ''}`;
  if (text.includes('任務')) return historyIconMap.task;
  if (text.includes('金幣')) return historyIconMap.coin;
  if (text.includes('卡牌')) return historyIconMap.card;
  if (text.includes('抽卡')) return historyIconMap.draw;
  if (text.includes('公告')) return historyIconMap.announcement;
  if (text.includes('群組')) return historyIconMap.group;
  return historyIconMap.system;
}

export default function HistoryList({ items }) {
  if (!items.length) {
    return (
      <div className="empty-text empty-with-icon">
        <UiIcon name="hourglass" className="empty-icon" />
        <p>目前沒有歷程紀錄</p>
      </div>
    );
  }

  return (
    <div className="history-list">
      {items.map((item) => (
        <article className="history-row" key={item.id}>
          <UiIcon src={historyIcon(item)} className="history-icon" />
          <div>
            <h3 className="history-card-title">{item.reason}</h3>
            <p className="history-card-time">{item.created_at}</p>
          </div>
          <div className="history-amount">
            <span className={item.amount >= 0 ? 'positive' : 'negative'}>{item.amount >= 0 ? '獲得' : '使用'}</span>
            <p className="icon-meta history-card-message"><UiIcon name="coin" /> {Math.abs(item.amount)} 金幣</p>
          </div>
        </article>
      ))}
    </div>
  );
}
