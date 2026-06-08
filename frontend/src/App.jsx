import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import Login from './features/auth/Login.jsx';
import JoinCastle from './features/auth/JoinCastle.jsx';
import Tasks from './features/tasks/Tasks.jsx';
import Treasure from './features/treasure/Treasure.jsx';
import MyVault from './features/treasure/MyVault.jsx';
import HistoryPage from './features/history/HistoryPage.jsx';
import TopMessage from './components/TopMessage.jsx';
import ProfileCard from './components/ProfileCard.jsx';
import TabBar from './components/TabBar.jsx';

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('study_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [tab, setTab] = useState('tasks');
  const [groupInfo, setGroupInfo] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [rewardCards, setRewardCards] = useState([]);
  const [myRewardCards, setMyRewardCards] = useState([]);
  const [toast, setToast] = useState('');

  const hasGroup = Boolean(session?.group?.id);

  function saveSession(data) {
    setSession(data);
    localStorage.setItem('study_session', JSON.stringify(data));
  }

  function logout() {
    localStorage.removeItem('study_session');
    localStorage.removeItem('studymeal_session');
    setSession(null);
    setGroupInfo(null);
    setTasks([]);
    setHistory([]);
    setRewardCards([]);
    setMyRewardCards([]);
    setTab('tasks');
  }

  async function refresh() {
    if (!session?.group?.id) {
      setGroupInfo(null);
      setTasks([]);
      setHistory([]);
      setRewardCards([]);
      setMyRewardCards([]);
      return;
    }

    const gid = session.group.id;
    const [group, taskList, historyList, cardList, myCards] = await Promise.all([
      api(`/group/${gid}`),
      api(`/tasks/${gid}`),
      api(`/history/${gid}`),
      api(`/groups/${gid}/reward-cards?user_id=${session.user.id}`),
      api(`/users/${session.user.id}/reward-cards`),
    ]);
    setGroupInfo(group);
    setTasks(taskList);
    setHistory(historyList);
    setRewardCards(cardList);
    setMyRewardCards(myCards);
  }

  useEffect(() => {
    refresh().catch((err) => setToast(err.message));
  }, [session]);

  async function joinGroup(passcode) {
    try {
      const data = await api('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id, passcode }),
      });
      saveSession({ ...session, group: data.group, user: data.user || session.user });
      setToast(`已加入 ${data.group.name}`);
      setTab('tasks');
    } catch (err) {
      setToast(err.message);
    }
  }

  if (!session) return <Login onLogin={saveSession} />;

  return (
    <div className="cloud-page">
      <div className="paper-grid" />
      <div className="snow-dots" />
      <main className="phone-shell">
        {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

        {!hasGroup ? (
          <JoinCastle user={session.user} onJoinGroup={joinGroup} onLogout={logout} />
        ) : (
          <>
            <TopMessage />
            <ProfileCard session={session} groupInfo={groupInfo} onLogout={logout} />
            <TabBar tab={tab} setTab={setTab} />

            {tab === 'tasks' && (
              <Tasks
                session={session}
                members={groupInfo?.members || []}
                tasks={tasks}
                refresh={refresh}
                setToast={setToast}
              />
            )}
            {tab === 'treasure' && (
              <Treasure
                session={session}
                rewardCards={rewardCards}
                refresh={refresh}
                setToast={setToast}
              />
            )}
            {tab === 'my-vault' && (
              <MyVault
                cards={myRewardCards}
                refresh={refresh}
                setToast={setToast}
              />
            )}
            {tab === 'history' && <HistoryPage history={history} />}
          </>
        )}
      </main>
    </div>
  );
}
