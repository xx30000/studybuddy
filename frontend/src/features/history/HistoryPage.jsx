import React from 'react';
import HistoryList from './HistoryList.jsx';

export default function HistoryPage({ history }) {
  return (
    <section className="white-card history-card">
      <div className="section-title blue"><span />金幣與任務歷程</div>
      <HistoryList items={history} />
    </section>
  );
}
