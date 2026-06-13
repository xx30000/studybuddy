import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { api } from './lib/api.js';
import Login from './features/auth/Login.jsx';
import JoinCastle from './features/auth/JoinCastle.jsx';
import Tasks from './features/tasks/Tasks.jsx';
import Treasure from './features/treasure/Treasure.jsx';
import MyVault from './features/treasure/MyVault.jsx';
import HistoryPage from './features/history/HistoryPage.jsx';
import NotificationsPage from './features/notifications/NotificationsPage.jsx';
import StudyMonitor from './features/study/StudyMonitor.jsx';
import TopMessage from './components/TopMessage.jsx';
import ProfileCard, { GroupAnnouncementPanel, GroupNameHeader } from './components/ProfileCard.jsx';
import TabBar from './components/TabBar.jsx';
import { UiIcon } from './lib/icons.js';

function toastIconName(message, type) {
  if (message?.includes('公告')) return 'announcement';
  if (message?.includes('抽卡')) return 'star';
  if (message?.includes('金幣')) return 'coin';
  if (message?.includes('Email')) return 'mail';
  if (message?.includes('群組') || message?.includes('通關密語')) return 'key';
  if (type === 'success') return 'check';
  if (type === 'error') return 'bell';
  return 'bell';
}

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('study_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [tab, setTab] = useState('home');
  const [previousTab, setPreviousTab] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [rewardCards, setRewardCards] = useState([]);
  const [myRewardCards, setMyRewardCards] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [userGroups, setUserGroups] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [showGroupGate, setShowGroupGate] = useState(false);
  const [groupGateActionMode, setGroupGateActionMode] = useState(null);
  const [homeMode, setHomeMode] = useState(() => (session?.group?.id ? 'group' : 'personal'));

  const hasGroup = homeMode === 'group' && Boolean(session?.group?.id);
  const lastGroupKey = session?.user?.id ? `lastGroupId_${session.user.id}` : null;

  function saveSession(data) {
    setSession(data);
    localStorage.setItem('study_session', JSON.stringify(data));
  }

  function logout() {
    localStorage.removeItem('study_session');
    localStorage.removeItem('studymeal_session');
    localStorage.removeItem('study_selected_group_id');
    if (lastGroupKey) localStorage.removeItem(lastGroupKey);
    setSession(null);
    setGroupInfo(null);
    setTasks([]);
    setHistory([]);
    setRewardCards([]);
    setMyRewardCards([]);
    setNotifications([]);
    setAnnouncements([]);
    setUserGroups([]);
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setHomeMode('personal');
    setPreviousTab(null);
    setTab('home');
  }

  function showToast(message, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, type, leaving: false }]);
    setTimeout(() => {
      setToasts((current) => current.map((toast) => (
        toast.id === id ? { ...toast, leaving: true } : toast
      )));
    }, 2600);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  function updateUserCoins(nextCoins) {
    if (nextCoins === undefined || nextCoins === null || !session?.user) return;
    const nextSession = {
      ...session,
      user: {
        ...session.user,
        coins: nextCoins,
        coin: nextCoins,
      },
    };
    saveSession(nextSession);
  }

  async function refreshNotifications() {
    if (!session?.group?.id || !session?.user?.id) {
      setNotifications([]);
      return;
    }
    const data = await api(`/groups/${session.group.id}/notifications?user_id=${session.user.id}`);
    setNotifications(data.notifications || []);
  }

  async function refreshAnnouncements() {
    if (!session?.group?.id || !session?.user?.id) {
      setAnnouncements([]);
      return;
    }
    const data = await api(`/groups/${session.group.id}/announcements`);
    setAnnouncements(data.announcements || []);
  }

  function updateCurrentGroup(nextGroup) {
    if (!nextGroup?.id) return;
    const nextSession = { ...session, group: nextGroup };
    saveSession(nextSession);
    setGroupInfo({ group: nextGroup, members: nextGroup.members || groupInfo?.members || [] });
  }

  async function enterGroup(group) {
    if (!group?.id) return;
    const data = await api(`/groups/${group.id}`);
    const nextGroup = data.group;
    localStorage.setItem('study_selected_group_id', String(nextGroup.id));
    if (lastGroupKey) localStorage.setItem(lastGroupKey, String(nextGroup.id));
    saveSession({ ...session, group: nextGroup });
    setGroupInfo({ group: nextGroup, members: nextGroup.members || [] });
    setAnnouncements(nextGroup.announcements || []);
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setHomeMode('group');
    setPreviousTab(null);
    setTab('home');
  }

  async function loadUserGroups(allowStoredSelection = false) {
    if (!session?.user?.id) return;
    const data = await api(`/users/${session.user.id}/groups`);
    const groups = data.groups || [];
    setUserGroups(groups);

    if (allowStoredSelection) {
      const storageKey = `lastGroupId_${session.user.id}`;
      const storedGroupId = localStorage.getItem(storageKey);
      const selected = groups.find((group) => String(group.id) === String(storedGroupId));
      if (selected) {
        await enterGroup(selected);
      } else {
        localStorage.removeItem(storageKey);
        saveSession({ ...session, group: null });
        setHomeMode('personal');
      }
    }
  }

  async function refresh() {
    if (!session?.group?.id) {
      setGroupInfo(null);
      setTasks([]);
      setHistory([]);
      setRewardCards([]);
      setMyRewardCards([]);
      setNotifications([]);
      setAnnouncements([]);
      return;
    }

    const gid = session.group.id;
    const [group, taskList, historyList, cardList, myCards, notificationData, announcementData] = await Promise.all([
      api(`/group/${gid}`),
      api(`/groups/${gid}/tasks`),
      api(`/history/${gid}`),
      api(`/groups/${gid}/reward-cards?user_id=${session.user.id}`),
      api(`/users/${session.user.id}/reward-cards`),
      api(`/groups/${gid}/notifications?user_id=${session.user.id}`),
      api(`/groups/${gid}/announcements`),
    ]);
    setGroupInfo(group);
    setTasks(taskList.tasks || taskList);
    setHistory(historyList);
    setRewardCards(cardList);
    setMyRewardCards(myCards);
    setNotifications(notificationData.notifications || []);
    setAnnouncements(announcementData.announcements || []);
  }

  useEffect(() => {
    refresh().catch((err) => showToast(err.message, 'error'));
  }, [session]);

  useEffect(() => {
    if (session?.user?.id) {
      loadUserGroups(!session?.group?.id).catch((err) => showToast(err.message, 'error'));
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (tab === 'notifications') {
      refreshNotifications().catch((err) => showToast(err.message, 'error'));
    }
  }, [tab]);

  async function joinGroup(passcode) {
    try {
      const data = await api('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id, passcode }),
      });
      localStorage.setItem('study_selected_group_id', String(data.group.id));
      if (lastGroupKey) localStorage.setItem(lastGroupKey, String(data.group.id));
      saveSession({ ...session, group: data.group, user: data.user || session.user });
      setGroupInfo({ group: data.group, members: data.group.members || [] });
      setAnnouncements(data.group.announcements || []);
      loadUserGroups(false).catch(() => {});
      showToast(`已加入 ${data.group.name}`, 'success');
      setShowGroupGate(false);
      setGroupGateActionMode(null);
      setHomeMode('group');
      setPreviousTab(null);
      setTab('home');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function createGroup(form) {
    try {
      const data = await api('/groups', {
        method: 'POST',
        body: JSON.stringify({ ...form, user_id: session.user.id }),
      });
      localStorage.setItem('study_selected_group_id', String(data.group.id));
      if (lastGroupKey) localStorage.setItem(lastGroupKey, String(data.group.id));
      saveSession({ ...session, group: data.group });
      setGroupInfo({ group: data.group, members: data.group.members || [] });
      setAnnouncements(data.group.announcements || []);
      loadUserGroups(false).catch(() => {});
      showToast(`已建立 ${data.group.name}`, 'success');
      setShowGroupGate(false);
      setGroupGateActionMode(null);
      setHomeMode('group');
      setPreviousTab(null);
      setTab('home');
    } catch (err) {
      showToast(err.message || '建立群組失敗', 'error');
    }
  }

  async function selectGroup(group) {
    try {
      await enterGroup(group);
      showToast(`已切換到 ${group.name}`, 'success');
    } catch (err) {
      showToast(err.message || '加入群組失敗', 'error');
    }
  }

  function loginAndEnterHome(data) {
    saveSession({ ...data, group: null });
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setHomeMode('personal');
    setPreviousTab(null);
    setTab('home');
  }

  function goToTab(nextTab) {
    if (nextTab === tab) return;
    setPreviousTab(tab);
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setTab(nextTab);
  }

  function handleBack() {
    if (groupGateActionMode) {
      setGroupGateActionMode(null);
      return;
    }

    if (showGroupGate) {
      setShowGroupGate(false);
      setPreviousTab(null);
      setTab('home');
      return;
    }

    if (previousTab && previousTab !== tab) {
      setTab(previousTab);
      setPreviousTab(null);
      return;
    }

    setTab('home');
    setPreviousTab(null);
  }

  function switchToPersonalMode() {
    if (lastGroupKey) localStorage.removeItem(lastGroupKey);
    localStorage.removeItem('study_selected_group_id');
    saveSession({ ...session, group: null });
    setGroupInfo(null);
    setTasks([]);
    setHistory([]);
    setRewardCards([]);
    setNotifications([]);
    setAnnouncements([]);
    setHomeMode('personal');
    setGroupGateActionMode(null);
    setTab('home');
  }

  function renderNoGroupHome() {
    return (
      <div className="home-stack">
        <section className="white-card personal-study-card home-card">
          <div className="personal-study-head">
            <UiIcon name="cat-book" className="hero-icon" />
            <div>
              <small className="icon-meta"><UiIcon name="sprout" /> 個人讀書模式</small>
              <h2>今天也先把自己的節奏顧好</h2>
              <p>你目前正在使用個人讀書模式。可以先自己讀書，也可以到「設定」裡的共讀群組管理建立或加入群組。</p>
            </div>
          </div>
        </section>

        <StudyMonitor
          session={session}
          currentGroup={null}
          setToast={showToast}
          onUserCoinsUpdated={updateUserCoins}
        />

        <section className="white-card no-group-card home-card">
          <div>
            <div className="section-title blue">
              <span />
              <UiIcon name="friends" className="section-icon" />
              前往設定
            </div>
            <p>想建立或加入共讀群組，可以到「設定」裡的共讀群組管理。</p>
          </div>
          <div className="no-group-actions">
            <button className="primary-btn compact inline-action" type="button" onClick={() => {
              setGroupGateActionMode(null);
              setTab('settings');
            }}>
              <UiIcon name="gear" /> 前往設定
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsPage() {
    return (
      <div className="settings-page">
        <section className="settings-card home-card">
          <div className="settings-title-row">
            <img
              src="/images/icons-transparent/gear.png"
              alt=""
              className="settings-title-icon"
            />
            <h1 className="settings-title">設定</h1>
          </div>
          <div className="settings-section-title">目前模式</div>
          {hasGroup ? (
            <p>目前群組：{session.group.name}</p>
          ) : (
            <p>目前使用：個人讀書模式</p>
          )}
          {hasGroup && (
            <div className="settings-action-row">
              <button className="settings-action-button" type="button" onClick={switchToPersonalMode}>
                <UiIcon name="cat-book" /> 切換到個人讀書模式
              </button>
            </div>
          )}
        </section>
        <section className="settings-card settings-group-card home-card">
          <h3 className="settings-section-title"><UiIcon name="friends" /> 共讀群組管理</h3>
          <p>可以在這裡建立群組、加入群組、切換已加入的共讀群組。</p>
        </section>
        <JoinCastle
          user={session.user}
          groups={userGroups}
          onCreateGroup={createGroup}
          onJoinGroup={joinGroup}
          onSelectGroup={selectGroup}
          forcedActionMode={groupGateActionMode}
          onActionModeChange={setGroupGateActionMode}
          onSwitchToPersonal={switchToPersonalMode}
          currentGroupId={session?.group?.id}
        />
      </div>
    );
  }

  function renderGroupHome() {
    return (
      <>
        <section className="white-card home-card personal-mode-switch-card">
          <button className="note-button secondary" type="button" onClick={switchToPersonalMode}>
            <UiIcon name="cat-book" /> 切換到個人讀書模式
          </button>
        </section>
        <GroupNameHeader
          session={session}
          groupInfo={groupInfo}
          refresh={refresh}
          onGroupUpdated={updateCurrentGroup}
          setToast={showToast}
        />
        <TopMessage />
        <StudyMonitor
          session={session}
          currentGroup={session.group}
          refresh={refresh}
          setToast={showToast}
          onUserCoinsUpdated={updateUserCoins}
        />
        <GroupAnnouncementPanel
          session={session}
          groupInfo={groupInfo}
          announcements={announcements}
          refreshAnnouncements={refreshAnnouncements}
          refresh={refresh}
          setToast={showToast}
        />
        <ProfileCard
          session={session}
          groupInfo={groupInfo}
        />
      </>
    );
  }

  const shouldShowBackButton = Boolean(session) && tab === 'settings' && Boolean(groupGateActionMode);

  if (!session) return <Login onLogin={loginAndEnterHome} />;

  return (
    <div className="cloud-page">
      <div className="paper-grid" />
      <div className="snow-dots" />
      {shouldShowBackButton && (
        <button
          type="button"
          className="global-back-arrow"
          onClick={handleBack}
          aria-label="??"
        >
          ?
        </button>
      )}
      <button
        type="button"
        className="global-logout-button"
        onClick={logout}
      >
        <LogOut size={18} />
        登出
      </button>
      <main className="phone-shell notebook-page">
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div className={`toast-note ${toast.type} ${toast.leaving ? 'leaving' : ''}`} key={toast.id}>
              <UiIcon name={toastIconName(toast.message, toast.type)} className="toast-icon" />
              <span>{toast.message}</span>
            </div>
          ))}
        </div>

        <TabBar tab={tab} setTab={goToTab} />

        <div className="home-layout-center">
          {tab === 'home' && (hasGroup ? renderGroupHome() : renderNoGroupHome())}
          {tab === 'settings' && renderSettingsPage()}
          {tab !== 'home' && tab !== 'settings' && !hasGroup && renderNoGroupHome()}

          {hasGroup && tab !== 'home' && tab !== 'settings' && (
            <>
              {tab === 'tasks' && (
                <Tasks
                  session={session}
                  members={groupInfo?.members || []}
                  tasks={tasks}
                  refresh={refresh}
                  setToast={showToast}
                />
              )}
              {tab === 'treasure' && (
                <Treasure
                  session={session}
                  rewardCards={rewardCards}
                  refresh={refresh}
                  setToast={showToast}
                />
              )}
              {tab === 'my-vault' && (
                <MyVault
                  cards={myRewardCards}
                  refresh={refresh}
                  setToast={showToast}
                />
              )}
              {tab === 'history' && <HistoryPage history={history} />}
              {tab === 'notifications' && (
                <NotificationsPage
                  session={session}
                  notifications={notifications}
                  refreshNotifications={refreshNotifications}
                  setToast={showToast}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
