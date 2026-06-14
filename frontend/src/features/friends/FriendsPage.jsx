import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, Send, UserPlus, X } from 'lucide-react';
import {
  acceptFriendRequest,
  acceptFriendStudyInvite,
  cancelFriendRequest,
  getFriendProfile,
  getFriends,
  getIncomingFriendRequests,
  getIncomingFriendStudyInvites,
  getOutgoingFriendRequests,
  rejectFriendRequest,
  rejectFriendStudyInvite,
  searchUsers,
  sendFriendRequest,
  sendFriendStudyInvite,
} from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

const FRIEND_TABS = [
  { id: 'search', label: '搜尋好友', icon: 'mail' },
  { id: 'requests', label: '好友邀請', icon: 'bell' },
  { id: 'friends', label: '我的好友', icon: 'friends' },
  { id: 'study', label: '一起讀書', icon: 'hourglass' },
];

function statusLabel(status) {
  if (status === 'studying') return '讀書中';
  if (status === 'online') return '在線上';
  return '離線';
}

function actionText(status) {
  if (status === 'friends') return '已是好友';
  if (status === 'pending_sent') return '已送出邀請';
  if (status === 'pending_received') return '待你接受';
  return '加好友';
}

function FriendAvatar({ user }) {
  if (user?.avatar_data) {
    return <img className="friend-avatar" src={user.avatar_data} alt="" />;
  }
  return (
    <div className="friend-avatar placeholder">
      <UiIcon name="cat-face" />
    </div>
  );
}

export default function FriendsPage({ session, setToast }) {
  const user = session?.user;
  const [activeTab, setActiveTab] = useState('search');
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [incomingStudyInvites, setIncomingStudyInvites] = useState([]);
  const [selectedFriendId, setSelectedFriendId] = useState(null);
  const [friendProfile, setFriendProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedFriend = useMemo(
    () => friends.find((friend) => String(friend.id) === String(selectedFriendId)),
    [friends, selectedFriendId],
  );

  async function loadFriends() {
    if (!user?.id) return;
    const data = await getFriends(user.id);
    setFriends(data.friends || []);
  }

  async function loadRequests() {
    if (!user?.id) return;
    const [incoming, outgoing] = await Promise.all([
      getIncomingFriendRequests(user.id),
      getOutgoingFriendRequests(user.id),
    ]);
    setIncomingRequests(incoming.requests || []);
    setOutgoingRequests(outgoing.requests || []);
  }

  async function loadStudyInvites() {
    if (!user?.id) return;
    const data = await getIncomingFriendStudyInvites(user.id);
    setIncomingStudyInvites(data.invites || []);
  }

  async function refreshAll() {
    setIsLoading(true);
    try {
      await Promise.all([loadFriends(), loadRequests(), loadStudyInvites()]);
    } catch (err) {
      setToast?.(err.message || '好友資料載入失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
  }, [user?.id]);

  useEffect(() => {
    if (!selectedFriendId || !user?.id) {
      setFriendProfile(null);
      return;
    }
    getFriendProfile(user.id, selectedFriendId)
      .then((data) => setFriendProfile(data.profile || null))
      .catch((err) => setToast?.(err.message || '好友個人頁載入失敗', 'error'));
  }, [selectedFriendId, user?.id]);

  async function handleSearch(event) {
    event.preventDefault();
    const q = keyword.trim();
    if (!q) {
      setToast?.('請輸入暱稱或 Email', 'error');
      return;
    }
    setIsLoading(true);
    try {
      const data = await searchUsers(q, user.id);
      setSearchResults(data.users || []);
    } catch (err) {
      setToast?.(err.message || '搜尋好友失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  async function requestFriend(receiverId) {
    try {
      const data = await sendFriendRequest(user.id, receiverId);
      setToast?.(data.message || '已送出好友邀請', 'success');
      await Promise.all([handleSilentSearch(), loadRequests()]);
    } catch (err) {
      setToast?.(err.message || '送出好友邀請失敗', 'error');
    }
  }

  async function handleSilentSearch() {
    const q = keyword.trim();
    if (!q) return;
    const data = await searchUsers(q, user.id);
    setSearchResults(data.users || []);
  }

  async function acceptRequest(requestId) {
    try {
      const data = await acceptFriendRequest(requestId);
      setToast?.(data.message || '已接受好友邀請', 'success');
      await refreshAll();
    } catch (err) {
      setToast?.(err.message || '接受好友邀請失敗', 'error');
    }
  }

  async function rejectRequest(requestId) {
    try {
      const data = await rejectFriendRequest(requestId);
      setToast?.(data.message || '已拒絕好友邀請', 'success');
      await loadRequests();
    } catch (err) {
      setToast?.(err.message || '拒絕好友邀請失敗', 'error');
    }
  }

  async function cancelRequest(requestId) {
    try {
      const data = await cancelFriendRequest(requestId);
      setToast?.(data.message || '已取消好友邀請', 'success');
      await Promise.all([handleSilentSearch(), loadRequests()]);
    } catch (err) {
      setToast?.(err.message || '取消好友邀請失敗', 'error');
    }
  }

  async function inviteStudy(friendId) {
    try {
      const data = await sendFriendStudyInvite(user.id, friendId);
      setToast?.(data.message || '已送出一起讀書邀請', 'success');
    } catch (err) {
      setToast?.(err.message || '送出一起讀書邀請失敗', 'error');
    }
  }

  async function acceptStudyInvite(inviteId) {
    try {
      const data = await acceptFriendStudyInvite(inviteId);
      setToast?.(data.message || '已建立好友讀書房', 'success');
      await loadStudyInvites();
    } catch (err) {
      setToast?.(err.message || '接受一起讀書邀請失敗', 'error');
    }
  }

  async function rejectStudyInvite(inviteId) {
    try {
      const data = await rejectFriendStudyInvite(inviteId);
      setToast?.(data.message || '已拒絕一起讀書邀請', 'success');
      await loadStudyInvites();
    } catch (err) {
      setToast?.(err.message || '拒絕一起讀書邀請失敗', 'error');
    }
  }

  return (
    <section className="friends-page settings-card home-card">
      <div className="friends-page-header">
        <div>
          <h2 className="friends-title"><UiIcon name="friends" /> 好友系統</h2>
          <p>搜尋好友、接受邀請，或找好友一起進入讀書房。</p>
        </div>
        {isLoading && <span className="friends-loading">載入中...</span>}
      </div>

      <div className="friends-tab-row" role="tablist" aria-label="好友系統分頁">
        {FRIEND_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`friends-tab ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <UiIcon name={item.icon} /> {item.label}
          </button>
        ))}
      </div>

      {activeTab === 'search' && (
        <div className="friends-panel">
          <form className="friend-search-form" onSubmit={handleSearch}>
            <input
              className="friend-search-input"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="輸入暱稱或 Email 搜尋好友"
            />
            <button className="friend-search-button" type="submit">
              <Search size={16} /> 搜尋
            </button>
          </form>

          <div className="friend-result-list">
            {searchResults.map((result) => (
              <article className="friend-result-item" key={result.id}>
                <FriendAvatar user={result} />
                <div className="friend-info">
                  <strong className="friend-name">{result.nickname}</strong>
                  <span className="friend-email">{result.email}</span>
                  <span className={`friend-status ${result.current_status}`}>{statusLabel(result.current_status)}</span>
                </div>
                <button
                  className="friend-action-button"
                  type="button"
                  disabled={result.friendship_status !== 'none'}
                  onClick={() => requestFriend(result.id)}
                >
                  <UserPlus size={15} /> {actionText(result.friendship_status)}
                </button>
              </article>
            ))}
            {!searchResults.length && <p className="friends-empty">輸入暱稱或 Email，就能找到朋友。</p>}
          </div>
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="friends-panel two-column">
          <section>
            <h3 className="friends-section-title">收到的好友邀請</h3>
            <div className="friend-requests-list">
              {incomingRequests.map((request) => (
                <article className="friend-request-item" key={request.id}>
                  <FriendAvatar user={request.requester} />
                  <div className="friend-info">
                    <strong>{request.requester.nickname}</strong>
                    <span>{request.requester.email}</span>
                  </div>
                  <div className="friend-request-actions">
                    <button type="button" className="friend-action-button" onClick={() => acceptRequest(request.id)}>
                      <Check size={15} /> 接受
                    </button>
                    <button type="button" className="friend-action-button muted" onClick={() => rejectRequest(request.id)}>
                      <X size={15} /> 拒絕
                    </button>
                  </div>
                </article>
              ))}
              {!incomingRequests.length && <p className="friends-empty">目前沒有新的好友邀請。</p>}
            </div>
          </section>

          <section>
            <h3 className="friends-section-title">已送出的邀請</h3>
            <div className="friend-requests-list">
              {outgoingRequests.map((request) => (
                <article className="friend-request-item" key={request.id}>
                  <FriendAvatar user={request.receiver} />
                  <div className="friend-info">
                    <strong>{request.receiver.nickname}</strong>
                    <span>{request.receiver.email}</span>
                  </div>
                  <button type="button" className="friend-action-button muted" onClick={() => cancelRequest(request.id)}>
                    取消邀請
                  </button>
                </article>
              ))}
              {!outgoingRequests.length && <p className="friends-empty">目前沒有等待中的送出邀請。</p>}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="friends-panel friends-grid">
          <section className="friends-list">
            <h3 className="friends-section-title">我的好友</h3>
            {friends.map((friend) => (
              <article
                className={`friend-list-item ${String(selectedFriendId) === String(friend.id) ? 'active' : ''}`}
                key={friend.id}
              >
                <button type="button" onClick={() => setSelectedFriendId(friend.id)}>
                  <FriendAvatar user={friend} />
                  <span>
                    <strong>{friend.nickname}</strong>
                    <small className={`friend-status ${friend.current_status}`}>{statusLabel(friend.current_status)}</small>
                  </span>
                </button>
                <button type="button" className="friend-action-button" onClick={() => inviteStudy(friend.id)}>
                  <Send size={15} /> 一起讀書
                </button>
              </article>
            ))}
            {!friends.length && <p className="friends-empty">還沒有好友。先到搜尋頁送出邀請吧。</p>}
          </section>

          <section className="friend-profile-card">
            {friendProfile || selectedFriend ? (
              <>
                <div className="friend-profile-head">
                  <FriendAvatar user={friendProfile || selectedFriend} />
                  <div>
                    <h3>{(friendProfile || selectedFriend).nickname}</h3>
                    <span className={`friend-status ${(friendProfile || selectedFriend).current_status}`}>
                      {statusLabel((friendProfile || selectedFriend).current_status)}
                    </span>
                  </div>
                </div>
                <div className="friend-profile-stats">
                  <div><strong>{friendProfile?.today_study_minutes ?? selectedFriend?.today_study_minutes ?? 0}</strong><span>今日讀書分鐘</span></div>
                  <div><strong>{friendProfile?.week_completed_tasks ?? selectedFriend?.week_completed_tasks ?? 0}</strong><span>本週完成任務</span></div>
                  <div><strong>{friendProfile?.coins ?? selectedFriend?.coins ?? 0}</strong><span>金幣</span></div>
                </div>
                <div className="friend-common-groups">
                  <b>共同群組</b>
                  {(friendProfile?.common_groups || selectedFriend?.common_groups || []).length > 0 ? (
                    <div>
                      {(friendProfile?.common_groups || selectedFriend?.common_groups || []).map((group) => (
                        <span key={group.id}>{group.name}</span>
                      ))}
                    </div>
                  ) : (
                    <p>目前沒有共同群組。</p>
                  )}
                </div>
              </>
            ) : (
              <p className="friends-empty">點選好友可以查看簡易讀書狀態。</p>
            )}
          </section>
        </div>
      )}

      {activeTab === 'study' && (
        <div className="friends-panel">
          <h3 className="friends-section-title">一起讀書邀請</h3>
          <div className="friend-requests-list">
            {incomingStudyInvites.map((invite) => (
              <article className="friend-study-invite-card" key={invite.id}>
                <FriendAvatar user={invite.inviter} />
                <div className="friend-info">
                  <strong>{invite.inviter.nickname}</strong>
                  <span>邀請你一起讀書</span>
                </div>
                <div className="friend-request-actions">
                  <button type="button" className="friend-action-button" onClick={() => acceptStudyInvite(invite.id)}>
                    <Check size={15} /> 接受
                  </button>
                  <button type="button" className="friend-action-button muted" onClick={() => rejectStudyInvite(invite.id)}>
                    <X size={15} /> 拒絕
                  </button>
                </div>
              </article>
            ))}
            {!incomingStudyInvites.length && (
              <p className="friends-empty">目前沒有一起讀書邀請。你也可以到好友列表邀請朋友。</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
