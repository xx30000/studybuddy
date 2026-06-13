import React from 'react';
import { UiIcon } from '../../lib/icons.js';
import HistoryList from './HistoryList.jsx';

export default function HistoryPage({ history }) {
  return (
    <section className="white-card history-card history-section home-card">
      <div className="section-title blue history-page-title"><span /><UiIcon name="hourglass" className="section-icon" />歷程紀錄</div>
      <HistoryList items={history} />
    </section>
  );
}
