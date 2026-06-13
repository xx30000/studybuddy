import React from 'react';
import { UiIcon } from '../lib/icons.js';

export default function TopMessage() {
  return (
    <section className="royal-message reminder-card study-reminder-card home-card">
      <div className="message-doodle"><UiIcon name="sprout" className="hero-icon" /></div>
      <div>
        <b className="icon-meta"><UiIcon name="star" /> 共讀提醒</b>
        <h2 className="hero-title-row reminder-title-main"><UiIcon name="coin" className="title-icon" />完成任務、累積金幣，解鎖你們的國庫獎勵。</h2>
        <p className="icon-meta"><UiIcon name="coin" /> 一起把專題進度變成看得見的小成果。</p>
      </div>
    </section>
  );
}
