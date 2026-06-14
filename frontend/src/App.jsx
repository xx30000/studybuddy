import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { api } from './lib/api.js';
import Login from './features/auth/Login.jsx';
import Tasks from './features/tasks/Tasks.jsx';
import Treasure from './features/treasure/Treasure.jsx';
import MyVault from './features/treasure/MyVault.jsx';
import HistoryPage from './features/history/HistoryPage.jsx';
import NotificationsPage from './features/notifications/NotificationsPage.jsx';
import StudyMonitor from './features/study/StudyMonitor.jsx';
import StatsPage from './features/stats/StatsPage.jsx';
import CheckinCard from './features/study/CheckinCard.jsx';
import SettingsPage from './features/settings/SettingsPage.jsx';
import GroupChat from './features/groups/GroupChat.jsx';
import TopMessage from './components/TopMessage.jsx';
import ProfileCard, { GroupAnnouncementPanel, GroupNameHeader } from './components/ProfileCard.jsx';
import TabBar from './components/TabBar.jsx';
import { UiIcon } from './lib/icons.js';

function toastIconName(message, type) {
  if (message?.includes('公告')) return 'announcement';
  if (message?.includes('抽卡') || message?.includes('獎勵')) return 'star';
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
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [groupGateActionMode, setGroupGateActionMode] = useState(null);
  const [homeMode, setHomeMode] = useState(() => (session?.group?.id ? 'group' : 'personal'));

  const hasGroup = homeMode === 'group' && Boolean(session?.group?.id);
  const lastGroupKey = session?.user?.id ? `lastGroupId_${session.user.id}` : null;

  function clearStoredTabState() {
    localStorage.removeItem('activeTab');
    localStorage.removeItem('study_active_tab');
    localStorage.removeItem('studybuddy_active_tab');
  }

  function saveSession(data) {
    setSession(data);
    localStorage.setItem('study_session', JSON.stringify(data));
  }

  function logout() {
    localStorage.removeItem('study_session');
    localStorage.removeItem('studymeal_session');
    localStorage.removeItem('study_selected_group_id');
    clearStoredTabState();
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
    setShowGroupSelector(false);
    setIsModeMenuOpen(false);
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

  function handleUserUpdated(nextUser) {
    if (!nextUser || !session?.user) return;
    saveSession({
      ...session,
      user: {
        ...session.user,
        ...nextUser,
      },
    });
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

  async function enterGroup(group, options = {}) {
    if (!group?.id) return;
    const { goHome = true } = options;
    const data = await api(`/groups/${group.id}`);
    const nextGroup = data.group;
    localStorage.setItem('study_selected_group_id', String(nextGroup.id));
    if (lastGroupKey) localStorage.setItem(lastGroupKey, String(nextGroup.id));
    saveSession({ ...session, group: nextGroup });
    setGroupInfo({ group: nextGroup, members: nextGroup.members || [] });
    setAnnouncements(nextGroup.announcements || []);
    setShowGroupGate(false);
    setShowGroupSelector(false);
    setIsModeMenuOpen(false);
    setGroupGateActionMode(null);
    setHomeMode('group');
    if (goHome) {
      setPreviousTab(null);
      setTab('home');
    }
  }

  async function loadUserGroups(allowStoredSelection = false) {
    if (!session?.user?.id) return;
    const data = await api(`/users/${session.user.id}/groups`);
    const groups = data.groups || [];
    setUserGroups(groups);

    const storageKey = `lastGroupId_${session.user.id}`;
    const storedGroupId = localStorage.getItem(storageKey);
    const selected = storedGroupId
      ? groups.find((group) => String(group.id) === String(storedGroupId))
      : null;
    const sessionGroupStillExists = session?.group?.id
      ? groups.some((group) => String(group.id) === String(session.group.id))
      : false;

    if (allowStoredSelection && selected) {
      await enterGroup(selected, { goHome: false });
      return;
    }

    if (session?.group?.id && !sessionGroupStillExists) {
      localStorage.removeItem(storageKey);
      localStorage.removeItem('study_selected_group_id');
      saveSession({ ...session, group: null });
      setHomeMode('personal');
      return;
    }

    if (!selected && storedGroupId) {
      localStorage.removeItem(storageKey);
    }

    if (!session?.group?.id) {
      setHomeMode('personal');
    }
  }


  function clearGroupScopedData() {
    setGroupInfo(null);
    setTasks([]);
    setHistory([]);
    setRewardCards([]);
    setMyRewardCards([]);
    setNotifications([]);
    setAnnouncements([]);
  }

  async function refreshHomeData() {
    if (!session?.group?.id || !session?.user?.id) {
      clearGroupScopedData();
      return;
    }

    const gid = session.group.id;
    const [group, announcementData] = await Promise.all([
      api(`/group/${gid}`),
      api(`/groups/${gid}/announcements`),
    ]);
    setGroupInfo(group);
    setAnnouncements(announcementData.announcements || []);
  }

  async function refreshTaskData() {
    if (!session?.group?.id || !session?.user?.id) {
      clearGroupScopedData();
      return;
    }

    const gid = session.group.id;
    const [group, taskList] = await Promise.all([
      api(`/group/${gid}`),
      api(`/groups/${gid}/tasks`),
    ]);
    setGroupInfo(group);
    setTasks(taskList.tasks || taskList);
  }

  async function refreshTreasureData() {
    if (!session?.group?.id || !session?.user?.id) {
      clearGroupScopedData();
      return;
    }

    const gid = session.group.id;
    const cardList = await api(`/groups/${gid}/reward-cards?user_id=${session.user.id}`);
    setRewardCards(cardList);
  }

  async function refreshMyVaultData() {
    if (!session?.user?.id) {
      setMyRewardCards([]);
      return;
    }

    const myCards = await api(`/users/${session.user.id}/reward-cards`);
    setMyRewardCards(myCards);
  }

  async function refreshHistoryData() {
    if (!session?.group?.id) {
      setHistory([]);
      return;
    }

    const historyList = await api(`/history/${session.group.id}`);
    setHistory(historyList);
  }

  async function refresh() {
    if (!session?.group?.id || !session?.user?.id) {
      clearGroupScopedData();
      return;
    }

    if (tab === 'settings') {
      return;
    }

    if (tab === 'tasks') {
      await refreshTaskData();
      return;
    }
    if (tab === 'treasure') {
      await refreshTreasureData();
      return;
    }
    if (tab === 'my-vault') {
      await refreshMyVaultData();
      return;
    }
    if (tab === 'history') {
      await refreshHistoryData();
      return;
    }
    if (tab === 'notifications') {
      await refreshNotifications();
      return;
    }

    await refreshHomeData();
  }

  useEffect(() => {
    if (!session?.group?.id || !session?.user?.id) {
      clearGroupScopedData();
      return;
    }
    refresh().catch((err) => showToast(err.message, 'error'));
  }, [session?.group?.id, session?.user?.id, tab]);

  useEffect(() => {
    if (session?.user?.id) {
      clearStoredTabState();
      loadUserGroups(true).catch((err) => showToast(err.message, 'error'));
    }
  }, [session?.user?.id]);

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
      setShowGroupSelector(false);
      setIsModeMenuOpen(false);
      setGroupGateActionMode(null);
      setHomeMode('group');
      setPreviousTab(null);
      setTab('home');
    } catch (err) {
      showToast(err.message || '加入群組失敗', 'error');
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
      setShowGroupSelector(false);
      setIsModeMenuOpen(false);
      setGroupGateActionMode(null);
      setHomeMode('group');
      setPreviousTab(null);
      setTab('home');
    } catch (err) {
      showToast(err.message || '建立群組失敗', 'error');
    }
  }

  function loginAndEnterHome(data) {
    clearStoredTabState();
    localStorage.removeItem('study_selected_group_id');
    saveSession({ ...data, group: null });
    setShowGroupGate(false);
    setShowGroupSelector(false);
    setIsModeMenuOpen(false);
    setGroupGateActionMode(null);
    setHomeMode('personal');
    setPreviousTab(null);
    setTab('home');
  }

  async function selectGroupFromModeMenu(group) {
    try {
      await enterGroup(group);
      showToast(`已切換到 ${group.name}`, 'success');
    } catch (err) {
      showToast(err.message || '切換群組失敗', 'error');
    }
  }

  function openGroupSelector() {
    setPreviousTab(tab);
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setShowGroupSelector(true);
    setIsModeMenuOpen(false);
    setTab('settings');
  }

  function toggleGroupSelector() {
    if (showGroupSelector) {
      setGroupGateActionMode(null);
    }
    setShowGroupSelector((current) => !current);
  }

  function goToTab(nextTab) {
    if (nextTab === tab) return;
    setPreviousTab(tab);
    setShowGroupGate(false);
    setGroupGateActionMode(null);
    setShowGroupSelector(false);
    setTab(nextTab);
  }

  function handleBack() {
    if (groupGateActionMode) {
      setGroupGateActionMode(null);
      return;
    }

    if (showGroupSelector) {
      setShowGroupSelector(false);
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
    setShowGroupSelector(false);
    setIsModeMenuOpen(false);
    setGroupGateActionMode(null);
    setTab('home');
  }

  function renderNeedsGroupPage(pageId) {
    const pageMeta = {
      tasks: { title: '任務', icon: 'check' },
      treasure: { title: '國庫', icon: 'bag' },
      'my-vault': { title: '寶庫', icon: 'star' },
      notifications: { title: '通知', icon: 'bell' },
      history: { title: '歷程紀錄', icon: 'hourglass' },
    };
    const meta = pageMeta[pageId] || { title: '共讀功能', icon: 'friends' };

    return (
      <section className="white-card no-group-card home-card">
        <div className="section-title blue">
          <span />
          <UiIcon name={meta.icon} className="section-icon" />
          {meta.title}
        </div>
        <p>此功能需要先選擇共讀群組。可以使用右上角選單切換群組，或到設定中的共讀群組管理建立 / 加入群組。</p>
        <div className="no-group-actions">
          <button
            className="primary-btn compact inline-action"
            type="button"
            onClick={openGroupSelector}
          >
            <UiIcon name="gear" /> 前往設定
          </button>
        </div>
      </section>
    );
  }


  function renderNoGroupHome() {
    return (
      <div className="home-stack">
        <section className="white-card personal-study-card home-card">
          <div className="personal-study-head">
            <UiIcon name="cat-book" className="hero-icon" />
            <div>
              <small className="icon-meta"><UiIcon name="sprout" /> 個人讀書模式</small>
              <h2>今天也一起好好讀書</h2>
              <p>你目前正在使用個人讀書模式。可以先自己讀書，也可以到設定裡的共讀群組管理建立或加入群組。</p>
            </div>
          </div>
        </section>

        <StudyMonitor
          session={session}
          currentGroup={null}
          setToast={showToast}
          onUserCoinsUpdated={updateUserCoins}
        />
        <CheckinCard
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
              共讀群組
            </div>
            <p>想建立或加入共讀群組，可以到設定裡的共讀群組管理。</p>
          </div>
          <div className="no-group-actions">
            <button className="primary-btn compact inline-action" type="button" onClick={() => {
              setGroupGateActionMode(null);
              openGroupSelector();
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
      <SettingsPage
        session={session}
        hasGroup={hasGroup}
        userGroups={userGroups}
        showGroupSelector={showGroupSelector}
        toggleGroupSelector={toggleGroupSelector}
        groupGateActionMode={groupGateActionMode}
        setGroupGateActionMode={setGroupGateActionMode}
        createGroup={createGroup}
        joinGroup={joinGroup}
        onUserUpdated={handleUserUpdated}
        setToast={showToast}
      />
    );
  }


  function renderGroupHome() {
    return (
      <>
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
        <CheckinCard
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
        <GroupChat
          currentGroup={session.group}
          user={session.user}
          latestAnnouncement={announcements[announcements.length - 1] || null}
          setToast={showToast}
        />
        <ProfileCard
          session={session}
          groupInfo={groupInfo}
        />
      </>
    );
  }

  const shouldShowBackButton = Boolean(session) && tab === 'settings' && (showGroupSelector || Boolean(groupGateActionMode));

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
          aria-label="返回"
        >
          ←
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
      <button
        type="button"
        className="mode-menu-button"
        onClick={() => setIsModeMenuOpen(true)}
        aria-label="開啟讀書模式選單"
      >
        ☰
      </button>
      {isModeMenuOpen && (
        <div className="mode-sidebar-backdrop" onClick={() => setIsModeMenuOpen(false)}>
          <aside className="mode-sidebar" onClick={(event) => event.stopPropagation()} aria-label="讀書模式選單">
            <div className="mode-sidebar-header">
              <h2 className="mode-sidebar-title">讀書模式</h2>
              <button
                type="button"
                className="mode-sidebar-close"
                onClick={() => setIsModeMenuOpen(false)}
                aria-label="關閉讀書模式選單"
              >
                ×
              </button>
            </div>

            <section className="mode-sidebar-section">
              <div className="mode-sidebar-helper">目前模式</div>
              <div className="mode-sidebar-current">
                {hasGroup ? `目前：${session.group.name}` : '目前：個人讀書模式'}
              </div>
            </section>

            <section className="mode-sidebar-section">
              <div className="mode-sidebar-helper">模式切換</div>
              <button
                type="button"
                className={`mode-sidebar-option ${!hasGroup ? 'active' : ''}`}
                onClick={switchToPersonalMode}
              >
                <UiIcon name="cat-book" /> 個人讀書模式
              </button>
            </section>

            <section className="mode-sidebar-section">
              <div className="mode-sidebar-helper">已加入的共讀群組</div>
              {userGroups.length > 0 ? (
                <div className="mode-sidebar-group-list">
                  {userGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`mode-sidebar-option ${String(session?.group?.id) === String(group.id) ? 'active' : ''}`}
                      onClick={() => selectGroupFromModeMenu(group)}
                    >
                      <UiIcon name="flag" /> {group.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mode-sidebar-helper">尚未加入任何共讀群組</p>
              )}
            </section>

            <section className="mode-sidebar-section">
              <button
                type="button"
                className="mode-sidebar-manage-button"
                onClick={openGroupSelector}
              >
                <UiIcon name="gear" /> 前往共讀群組管理
              </button>
            </section>
          </aside>
        </div>
      )}

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`toast-note ${toast.type} ${toast.leaving ? 'leaving' : ''}`} key={toast.id}>
            <UiIcon name={toastIconName(toast.message, toast.type)} className="toast-icon" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      <main className="phone-shell notebook-page">
        <TabBar tab={tab} setTab={goToTab} />

        <div className="home-layout-center">
          {tab === 'home' && (hasGroup ? renderGroupHome() : renderNoGroupHome())}
          {tab === 'settings' && renderSettingsPage()}
          {tab === 'stats' && (
            <StatsPage
              session={session}
              currentGroup={hasGroup ? session.group : null}
              setToast={showToast}
              onOpenGroupSelector={openGroupSelector}
            />
          )}
          {tab !== 'home' && tab !== 'settings' && tab !== 'stats' && !hasGroup && renderNeedsGroupPage(tab)}

          {hasGroup && tab !== 'home' && tab !== 'settings' && tab !== 'stats' && (
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
