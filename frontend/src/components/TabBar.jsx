import React from 'react';
import { BookOpen, Gift, History, PackageCheck } from 'lucide-react';

const TABS = [
  { id: 'tasks', label: '任務', icon: BookOpen },
  { id: 'treasure', label: '國庫', icon: Gift },
  { id: 'my-vault', label: '我的', icon: PackageCheck },
  { id: 'history', label: '歷程', icon: History },
];

export default function TabBar({ tab, setTab }) {
  return (
    <nav className="tab-bar">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
          <Icon size={20} />
          {label}
        </button>
      ))}
    </nav>
  );
}
