import React, { useEffect, useMemo, useState } from 'react';
import JoinCastle from '../auth/JoinCastle.jsx';
import FriendsPage from '../friends/FriendsPage.jsx';
import { UiIcon } from '../../lib/icons.js';
import {
  deleteUserAvatar,
  getApiBaseUrl,
  updateUserAvatar,
  updateUserPassword,
  updateUserProfile,
} from '../../lib/api.js';

const THEMES = [
  { id: 'blue', label: '淡藍筆記', helper: '清爽、安靜，適合長時間讀書' },
  { id: 'milk-tea', label: '奶茶紙感', helper: '溫暖、柔和，像手帳頁面' },
  { id: 'pink', label: '淡粉便利貼', helper: '可愛但不刺眼' },
  { id: 'green', label: '嫩芽綠', helper: '放鬆、乾淨，適合早晨讀書' },
];

const FONT_SIZES = [
  { id: 'small', label: '小', scale: '0.94' },
  { id: 'medium', label: '中', scale: '1' },
  { id: 'large', label: '大', scale: '1.08' },
];

const NOTIFICATION_OPTIONS = [
  { key: 'settings_notify_task', label: '任務提醒', description: '任務新增、完成與重點任務提示' },
  { key: 'settings_notify_coin', label: '金幣提醒', description: '獲得金幣與金幣不足提示' },
  { key: 'settings_notify_checkin', label: '打卡提醒', description: '每日讀書打卡與連續打卡提示' },
  { key: 'settings_notify_announcement', label: '公告提醒', description: '群組公告新增提示' },
  { key: 'settings_notify_toast', label: 'Toast 提示', description: '畫面上方的小紙條提示' },
];

function readStoredBoolean(key, fallback = true) {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === 'true';
}

function applyAppearance(theme, fontSize) {
  document.body.classList.remove('theme-blue', 'theme-milk-tea', 'theme-pink', 'theme-green');
  document.body.classList.add(`theme-${theme}`);
  const selectedSize = FONT_SIZES.find((item) => item.id === fontSize) || FONT_SIZES[1];
  document.documentElement.style.setProperty('--app-font-scale', selectedSize.scale);
}

export default function SettingsPage({
  session,
  hasGroup,
  userGroups,
  showGroupSelector,
  toggleGroupSelector,
  groupGateActionMode,
  setGroupGateActionMode,
  createGroup,
  joinGroup,
  onUserUpdated,
  setToast,
}) {
  const user = session.user;
  const [nicknameDraft, setNicknameDraft] = useState(user.nickname || user.name || '');
  const [isPasswordEditing, setIsPasswordEditing] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [avatarPreview, setAvatarPreview] = useState(user.avatar_data || '');
  const [theme, setTheme] = useState(() => localStorage.getItem('studybuddy_theme') || 'blue');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('studybuddy_font_size') || 'medium');
  const [notificationSettings, setNotificationSettings] = useState(() => (
    NOTIFICATION_OPTIONS.reduce((acc, item) => {
      acc[item.key] = readStoredBoolean(item.key, true);
      return acc;
    }, {})
  ));

  const joinedGroupNames = useMemo(
    () => userGroups.map((group) => group.name).filter(Boolean).join('、'),
    [userGroups],
  );

  useEffect(() => {
    setNicknameDraft(user.nickname || user.name || '');
    setAvatarPreview(user.avatar_data || '');
  }, [user.id, user.nickname, user.name, user.avatar_data]);

  useEffect(() => {
    applyAppearance(theme, fontSize);
    localStorage.setItem('studybuddy_theme', theme);
    localStorage.setItem('studybuddy_font_size', fontSize);
  }, [theme, fontSize]);

  function updateNotificationSetting(key, checked) {
    setNotificationSettings((current) => ({ ...current, [key]: checked }));
    localStorage.setItem(key, String(checked));
  }

  async function saveNickname(event) {
    event.preventDefault();
    const nickname = nicknameDraft.trim();
    if (!nickname) {
      setToast?.('暱稱不可空白', 'error');
      return;
    }
    try {
      const data = await updateUserProfile(user.id, { nickname });
      onUserUpdated?.(data.user);
      setToast?.(data.message || '個人資料已更新', 'success');
    } catch (err) {
      setToast?.(err.message || '個人資料更新失敗', 'error');
    }
  }

  function resetPasswordForm() {
    setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
  }

  function cancelPasswordEdit() {
    resetPasswordForm();
    setIsPasswordEditing(false);
  }

  async function savePassword(event) {
    event.preventDefault();
    if (!passwordForm.current_password || !passwordForm.new_password) {
      setToast?.('請輸入目前密碼與新密碼', 'error');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setToast?.('新密碼與確認密碼不一致', 'error');
      return;
    }
    try {
      const data = await updateUserPassword(user.id, {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      resetPasswordForm();
      setIsPasswordEditing(false);
      setToast?.(data.message || '密碼已更新', 'success');
    } catch (err) {
      setToast?.(err.message || '密碼更新失敗', 'error');
    }
  }

  function readAvatarFile(file) {
    if (!file) return;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setToast?.('頭像只支援 png、jpg、jpeg 或 webp', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setToast?.('頭像檔案不可超過 2MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const avatarData = String(reader.result || '');
      try {
        const data = await updateUserAvatar(user.id, avatarData);
        setAvatarPreview(data.user?.avatar_data || avatarData);
        onUserUpdated?.(data.user);
        setToast?.(data.message || '頭像已更新', 'success');
      } catch (err) {
        setToast?.(err.message || '頭像更新失敗', 'error');
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeAvatar() {
    try {
      const data = await deleteUserAvatar(user.id);
      setAvatarPreview('');
      onUserUpdated?.(data.user);
      setToast?.(data.message || '頭像已移除', 'success');
    } catch (err) {
      setToast?.(err.message || '頭像移除失敗', 'error');
    }
  }

  function clearNavigationCache() {
    localStorage.removeItem('activeTab');
    localStorage.removeItem('study_active_tab');
    localStorage.removeItem('studybuddy_active_tab');
    localStorage.removeItem('study_selected_group_id');
    setToast?.('本機導覽快取已清除', 'success');
  }

  function resetLocalSettings() {
    localStorage.removeItem('studybuddy_theme');
    localStorage.removeItem('studybuddy_font_size');
    NOTIFICATION_OPTIONS.forEach((item) => localStorage.removeItem(item.key));
    setTheme('blue');
    setFontSize('medium');
    setNotificationSettings(NOTIFICATION_OPTIONS.reduce((acc, item) => {
      acc[item.key] = true;
      return acc;
    }, {}));
    setToast?.('本機設定已恢復預設', 'success');
  }

  return (
    <div className="settings-page">
      <section className="settings-card settings-hero-card home-card">
        <div className="settings-title-row">
          <img
            src="/images/icons-transparent/gear.png"
            alt=""
            className="settings-title-icon"
            onError={(event) => {
              event.currentTarget.src = '/images/icons/gear.png';
            }}
          />
          <h1 className="settings-title">設定</h1>
        </div>
        <p className="settings-description">
          整理帳號、好友、共讀群組與本機顯示偏好，讓 StudyBuddy 用起來更順手。
        </p>
      </section>

      <FriendsPage session={session} setToast={setToast} />

      <section className="settings-card account-card home-card">
        <h2 className="settings-section-title"><UiIcon name="cat-face" /> 帳號設定</h2>

        <div className="account-profile-row">
          <div className="account-avatar-wrap">
            {avatarPreview ? (
              <img className="account-avatar" src={avatarPreview} alt="使用者頭像" />
            ) : (
              <div className="account-avatar-placeholder">
                <UiIcon name="cat-face" />
              </div>
            )}
            <label className="avatar-edit-button" aria-label="更換頭像">
              <UiIcon name="pencil" />
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(event) => readAvatarFile(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="account-profile-main">
            <strong>{user.nickname || user.name || 'StudyBuddy 夥伴'}</strong>
            <span>{user.email}</span>
            <p>支援 png、jpg、jpeg、webp，大小 2MB 以內。頭像會直接顯示在 App 裡。</p>
          </div>

          {avatarPreview && (
            <button className="avatar-remove-inline-button" type="button" onClick={removeAvatar}>
              移除頭像
            </button>
          )}
        </div>

        <form className="settings-form" onSubmit={saveNickname}>
          <label className="settings-label" htmlFor="settings-nickname">顯示暱稱</label>
          <div className="settings-inline-row">
            <input
              id="settings-nickname"
              className="settings-input"
              value={nicknameDraft}
              onChange={(event) => setNicknameDraft(event.target.value)}
              placeholder="輸入暱稱"
            />
            <button className="settings-button" type="submit">儲存暱稱</button>
          </div>
        </form>

        <div className="password-summary-row">
          <div>
            <span className="settings-label">密碼</span>
            <strong className="password-mask">********</strong>
          </div>
          <button
            className="password-edit-button"
            type="button"
            onClick={() => setIsPasswordEditing(true)}
          >
            編輯
          </button>
        </div>

        {isPasswordEditing && (
          <form className="password-edit-panel" onSubmit={savePassword}>
            <label className="password-field-row">
              <span>目前密碼</span>
              <input
                className="settings-input"
                type="password"
                value={passwordForm.current_password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                placeholder="輸入目前密碼"
                autoComplete="current-password"
              />
            </label>
            <label className="password-field-row">
              <span>新密碼</span>
              <input
                className="settings-input"
                type="password"
                value={passwordForm.new_password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                placeholder="輸入新密碼"
                autoComplete="new-password"
              />
            </label>
            <label className="password-field-row">
              <span>確認新密碼</span>
              <input
                className="settings-input"
                type="password"
                value={passwordForm.confirm_password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
                placeholder="再次輸入新密碼"
                autoComplete="new-password"
              />
            </label>
            <div className="password-actions">
              <button className="settings-button secondary" type="submit">更新密碼</button>
              <button className="password-cancel-button" type="button" onClick={cancelPasswordEdit}>取消</button>
            </div>
          </form>
        )}
      </section>

      <section className="settings-card home-card">
        <h2 className="settings-section-title"><UiIcon name="sprout" /> 外觀設定</h2>
        <p className="settings-description">只會存在這台裝置，不會寫入 Supabase。</p>
        <div className="settings-subtitle">主題顏色</div>
        <div className="theme-option-row">
          {THEMES.map((item) => (
            <button
              className={`theme-option theme-${item.id}-preview ${theme === item.id ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setTheme(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.helper}</span>
            </button>
          ))}
        </div>

        <div className="settings-subtitle">文字大小</div>
        <div className="font-size-option-row">
          {FONT_SIZES.map((item) => (
            <button
              className={`font-size-option ${fontSize === item.id ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setFontSize(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card settings-group-management-card group-management-card home-card">
        <div className="group-management-status">
          <h2 className="settings-section-title"><UiIcon name="friends" /> 共讀群組管理</h2>
          <p className="group-management-description">
            選擇、建立或加入共讀群組，讓任務、金幣與國庫獎勵可以一起累積。
          </p>
          <div className="settings-system-info compact">
            <span>目前模式：{hasGroup ? '群組讀書模式' : '個人讀書模式'}</span>
            {hasGroup && <span>目前群組：{session.group.name}</span>}
            <span>已加入：{joinedGroupNames || '尚未加入任何共讀群組'}</span>
          </div>
        </div>

        <div className="settings-action-row group-management-actions">
          <button
            className="settings-action-button group-management-button group-selector-toggle"
            type="button"
            onClick={toggleGroupSelector}
          >
            <UiIcon name="friends" /> {showGroupSelector ? '收合共讀群組管理' : '共讀群組管理'}
          </button>
        </div>

        {showGroupSelector && (
          <div className="group-selector-panel">
            <JoinCastle
              user={user}
              groups={userGroups}
              onCreateGroup={createGroup}
              onJoinGroup={joinGroup}
              forcedActionMode={groupGateActionMode}
              onActionModeChange={setGroupGateActionMode}
              currentGroupId={session?.group?.id}
            />
          </div>
        )}
      </section>

      <section className="settings-card home-card">
        <h2 className="settings-section-title"><UiIcon name="bell" /> 通知偏好</h2>
        <p className="settings-description">這些設定會存在瀏覽器 localStorage，不影響資料庫通知紀錄。</p>
        <div className="notification-toggle-list">
          {NOTIFICATION_OPTIONS.map((item) => (
            <label className="notification-toggle-row" key={item.key}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <input
                type="checkbox"
                checked={notificationSettings[item.key]}
                onChange={(event) => updateNotificationSetting(item.key, event.target.checked)}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-card home-card">
        <h2 className="settings-section-title"><UiIcon name="key" /> 資料與系統</h2>
        <div className="settings-action-row">
          <button className="settings-button secondary" type="button" onClick={clearNavigationCache}>
            清除本機導覽快取
          </button>
          <button className="settings-danger-button" type="button" onClick={resetLocalSettings}>
            恢復本機設定預設
          </button>
        </div>
        <div className="settings-system-info">
          <span>StudyBuddy v1.0</span>
          <span>API：{getApiBaseUrl()}</span>
          <span>登入帳號：{user.email}</span>
        </div>
      </section>
    </div>
  );
}
