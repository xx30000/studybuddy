import React from 'react';

const TABS = [
  { id: 'home', label: '首頁', icon: 'cat-book' },
  { id: 'tasks', label: '任務', icon: 'check' },
  { id: 'treasure', label: '國庫', icon: 'bag' },
  { id: 'my-vault', label: '寶庫', icon: 'star' },
  { id: 'notifications', label: '通知', icon: 'bell' },
  { id: 'stats', label: '統計', icon: 'task-list' },
  { id: 'settings', label: '設定', icon: 'gear' },
];

export default function TabBar({ tab, setTab }) {
  return (
    <nav className="bottom-nav" aria-label="底部導覽列">
      {TABS.map(({ id, label, icon }) => (
        <button
          key={id}
          className={`bottom-nav-item ${tab === id ? 'active' : ''}`}
          type="button"
          onClick={() => setTab(id)}
        >
          <img
            src={`/images/icons-transparent/${icon}.png`}
            alt=""
            className="bottom-nav-icon"
            onError={(event) => {
              event.currentTarget.src = `/images/icons/${icon}.png`;
            }}
          />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
