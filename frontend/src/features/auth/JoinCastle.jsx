import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { UiIcon } from '../../lib/icons.js';

export default function JoinCastle({
  user,
  groups = [],
  onCreateGroup,
  onJoinGroup,
  onSelectGroup,
  forcedActionMode,
  onActionModeChange,
  onSwitchToPersonal,
  currentGroupId,
}) {
  const [joinPasscode, setJoinPasscode] = useState('');
  const [groupActionMode, setGroupActionMode] = useState(null);
  const hasGroups = groups && groups.length > 0;
  const [createForm, setCreateForm] = useState({
    name: '',
    passcode: '',
    announcement: '本週目標：完成簡報與系統展示',
  });

  useEffect(() => {
    if (forcedActionMode !== groupActionMode) {
      setGroupActionMode(forcedActionMode || null);
    }
  }, [forcedActionMode]);

  useEffect(() => {
    onActionModeChange?.(groupActionMode);
  }, [groupActionMode, onActionModeChange]);

  function submitJoin(e) {
    e.preventDefault();
    onJoinGroup(joinPasscode);
  }

  function submitCreate(e) {
    e.preventDefault();
    onCreateGroup(createForm);
  }

  return (
    <section className="login-castle-card join-castle-card group-gate-card">
      <div className="logo-circle small-logo study-logo">
        <UiIcon name="sprout" className="hero-icon" />
        <span className="mini-crown">☆</span>
      </div>
      <div className="group-gate-header">
        <h1 className="group-gate-title">選擇你的共讀群組</h1>
        <p className="group-gate-subtitle">建立一個專題小組，或輸入通關密語加入朋友的群組。</p>
      </div>

      <div className="group-status-card">
        {hasGroups ? (
          <>
            <h2><UiIcon name="heart" /> 已加入的共讀群組</h2>
            <p>選擇一個群組進入共讀模式，也可以建立新群組或加入朋友的群組。</p>
            <div className="joined-group-list compact">
              {groups.map((group) => (
                <button
                  className={String(currentGroupId) === String(group.id) ? 'active' : ''}
                  type="button"
                  key={group.id}
                  onClick={() => onSelectGroup(group)}
                >
                  <UiIcon name="flag" /> {group.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2><UiIcon name="friends" /> 尚未加入共讀群組</h2>
            <p>加入群組後，就能使用任務分派、金幣、國庫卡牌池、通知與歷程紀錄。</p>
          </>
        )}

        <div className="group-action-buttons">
          <button
            className={groupActionMode === 'create' ? 'active' : ''}
            type="button"
            onClick={() => setGroupActionMode('create')}
          >
            <UiIcon name="flag" /> 建立群組
          </button>
          <button
            className={groupActionMode === 'join' ? 'active' : ''}
            type="button"
            onClick={() => setGroupActionMode('join')}
          >
            <UiIcon name="key" /> 加入群組
          </button>
        </div>
        {currentGroupId && (
          <button className="note-button secondary personal-mode-button" type="button" onClick={onSwitchToPersonal}>
            <UiIcon name="cat-book" /> 切換到個人讀書模式
          </button>
        )}
      </div>

      <div className="group-gate-grid single-form">
        {groupActionMode === 'create' && (
        <form onSubmit={submitCreate} className="castle-form group-form-card">
          <div className="section-title blue"><span /><UiIcon name="flag" className="section-icon" />建立群組</div>
          <label className="icon-meta"><UiIcon name="flag" /> 群組名稱</label>
          <input
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="期末專題小組"
          />
          <label className="icon-meta"><UiIcon name="key" /> 群組通關密語</label>
          <input
            value={createForm.passcode}
            onChange={(e) => setCreateForm({ ...createForm, passcode: e.target.value })}
            placeholder="final2026"
          />
          <label className="icon-meta"><UiIcon name="announcement" /> 群組公告</label>
          <textarea
            value={createForm.announcement}
            onChange={(e) => setCreateForm({ ...createForm, announcement: e.target.value })}
            placeholder="本週目標：完成簡報與系統展示"
          />
          <button className="primary-btn compact" type="submit"><Plus size={18} /> 建立群組</button>
          <button className="note-button secondary" type="button" onClick={() => setGroupActionMode(null)}>
            取消
          </button>
        </form>
        )}

        {groupActionMode === 'join' && (
        <form onSubmit={submitJoin} className="castle-form group-form-card">
          <div className="section-title pink"><span /><UiIcon name="key" className="section-icon" />加入群組</div>
          <label className="icon-meta"><UiIcon name="key" /> 輸入群組通關密語</label>
          <input
            value={joinPasscode}
            onChange={(e) => setJoinPasscode(e.target.value)}
            placeholder="請輸入通關密語"
          />
          <button className="primary-btn compact" type="submit"><UiIcon name="key" /> 加入群組</button>
          <button className="note-button secondary" type="button" onClick={() => setGroupActionMode(null)}>
            取消
          </button>
          <small>輸入朋友提供的通關密語，就能加入同一個共讀群組。</small>
        </form>
        )}
      </div>
    </section>
  );
}
