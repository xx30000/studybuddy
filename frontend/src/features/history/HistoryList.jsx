import React from 'react';

export default function HistoryList({ items }) {
  if (!items.length) return <p className="empty-text">目前沒有歷程紀錄</p>;

  return (
    <div className="history-list">
      {items.map((item) => (
        <article className="history-row" key={item.id}>
          <div>
            <h3>{item.reason}</h3>
            <p>{item.created_at}</p>
          </div>
          <div className="history-amount">
            <span className={item.amount >= 0 ? 'positive' : 'negative'}>{item.amount >= 0 ? '獲得' : '使用'}</span>
            <p>{Math.abs(item.amount)} 金幣</p>
          </div>
        </article>
      ))}
    </div>
  );
}
