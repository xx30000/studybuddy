const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_DEBUG = import.meta.env.DEV && import.meta.env.VITE_API_DEBUG === '1';

export function getApiBaseUrl() {
  return API_BASE_URL;
}

async function parseJsonResponse(response, url) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`API \u56de\u50b3\u683c\u5f0f\u932f\u8aa4\uff0c\u9810\u671f JSON\uff0c\u4f46\u6536\u5230\uff1a${preview || '\u7a7a\u5167\u5bb9'}\u3002\u8acb\u78ba\u8a8d VITE_API_BASE_URL \u6307\u5411 Flask/Render \u5f8c\u7aef\u3002${url}`);
  }

  return response.json();
}

export async function api(path, options = {}) {
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}/api${apiPath}`;
  const method = options.method || 'GET';

  if (API_DEBUG) {
    console.log('[API]', method, url);
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await parseJsonResponse(response, url);
  if (!response.ok) {
    throw new Error(data.message || data.error || 'API \u8acb\u6c42\u5931\u6557');
  }
  return data;
}

function hasValidGroupId(groupId) {
  return groupId !== undefined && groupId !== null && groupId !== '' && groupId !== 'null' && groupId !== 'undefined';
}

function checkinQuery(groupId) {
  return hasValidGroupId(groupId) ? `?group_id=${groupId}` : '';
}

export function createOrUpdateCheckin(payload) {
  return api('/checkins', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getTodayCheckin(userId, groupId) {
  return api(`/users/${userId}/checkins/today${checkinQuery(groupId)}`);
}

export function getGroupTodayCheckins(groupId) {
  return api(`/groups/${groupId}/checkins/today`);
}

export function getCheckinStreak(userId, groupId) {
  return api(`/users/${userId}/checkins/streak${checkinQuery(groupId)}`);
}

export function getTodayStudySummary(userId, groupId) {
  return api(`/users/${userId}/study-summary/today${checkinQuery(groupId)}`);
}

export function getGroupChatMessages(groupId, userId, limit = 50) {
  if (!hasValidGroupId(groupId) || !userId) {
    return Promise.resolve({ success: true, messages: [] });
  }
  const query = new URLSearchParams({
    user_id: String(userId),
    limit: String(limit),
  });
  return api(`/groups/${groupId}/chat/messages?${query.toString()}`);
}

export function sendGroupChatMessage(groupId, userId, message) {
  if (!hasValidGroupId(groupId) || !userId) {
    return Promise.reject(new Error('請先選擇共讀群組'));
  }
  return api(`/groups/${groupId}/chat/messages`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, message }),
  });
}

export function deleteGroupChatMessage(groupId, messageId, userId) {
  if (!hasValidGroupId(groupId) || !messageId || !userId) {
    return Promise.reject(new Error('缺少聊天室訊息資料'));
  }
  return api(`/groups/${groupId}/chat/messages/${messageId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function getTodos(userId, groupId) {
  return api(`/users/${userId}/todos${checkinQuery(groupId)}`);
}

export function getTodayTodos(userId, groupId) {
  return getTodos(userId, groupId);
}

export function createTodo(userId, todoOrTitle, groupId) {
  const payload = typeof todoOrTitle === 'object'
    ? { ...todoOrTitle }
    : { title: todoOrTitle, group_id: groupId || null };
  return api(`/users/${userId}/todos`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTodo(todoId, payload) {
  return api(`/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTodo(todoId) {
  return api(`/todos/${todoId}`, {
    method: 'DELETE',
  });
}

export function syncTasksToTodos(userId, groupId) {
  return api(`/users/${userId}/todos/sync-tasks${checkinQuery(groupId)}`, {
    method: 'POST',
  });
}

export function checkTodoReminders(userId, groupId) {
  return api(`/users/${userId}/todos/check-reminders${checkinQuery(groupId)}`, {
    method: 'POST',
  });
}

function statsQuery(groupId) {
  return hasValidGroupId(groupId) ? `?group_id=${groupId}` : '';
}

export function getUserStatsSummary(userId, groupId) {
  return api(`/users/${userId}/stats/summary${statsQuery(groupId)}`);
}

export function getUserStudyWeekStats(userId, groupId) {
  return api(`/users/${userId}/stats/study-week${statsQuery(groupId)}`);
}

export function getTodayStudyTimeline(userId, groupId) {
  return api(`/users/${userId}/stats/study-timeline-today${statsQuery(groupId)}`);
}

export function getUserCoinStats(userId, groupId) {
  return api(`/users/${userId}/stats/coins${statsQuery(groupId)}`);
}

export function getUserCheckinWeekStats(userId, groupId) {
  return api(`/users/${userId}/stats/checkin-week${statsQuery(groupId)}`);
}

export function getUserTaskTimeline(userId, groupId) {
  return api(`/users/${userId}/stats/task-timeline${statsQuery(groupId)}`);
}

export function getGroupStatsSummary(groupId) {
  return api(`/groups/${groupId}/stats/summary`);
}

export function getGroupContributionStats(groupId) {
  return api(`/groups/${groupId}/stats/contributions`);
}

export function getGroupTaskTimeline(groupId) {
  return api(`/groups/${groupId}/stats/task-timeline`);
}

export function getGroupCheckinWeekStats(groupId) {
  return api(`/groups/${groupId}/stats/checkin-week`);
}

export function updateUserProfile(userId, payload) {
  return api(`/users/${userId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateUserPassword(userId, payload) {
  return api(`/users/${userId}/password`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateUserAvatar(userId, avatarData) {
  return api(`/users/${userId}/avatar`, {
    method: 'POST',
    body: JSON.stringify({ avatar_data: avatarData }),
  });
}

export function deleteUserAvatar(userId) {
  return api(`/users/${userId}/avatar`, {
    method: 'DELETE',
  });
}

export function searchUsers(keyword, currentUserId) {
  const query = new URLSearchParams({
    q: keyword || '',
    current_user_id: currentUserId || '',
  });
  return api(`/users/search?${query.toString()}`);
}

export function sendFriendRequest(requesterId, receiverId) {
  return api('/friend-requests', {
    method: 'POST',
    body: JSON.stringify({ requester_id: requesterId, receiver_id: receiverId }),
  });
}

export function getIncomingFriendRequests(userId) {
  return api(`/users/${userId}/friend-requests/incoming`);
}

export function getOutgoingFriendRequests(userId) {
  return api(`/users/${userId}/friend-requests/outgoing`);
}

export function acceptFriendRequest(requestId) {
  return api(`/friend-requests/${requestId}/accept`, { method: 'PATCH' });
}

export function rejectFriendRequest(requestId) {
  return api(`/friend-requests/${requestId}/reject`, { method: 'PATCH' });
}

export function cancelFriendRequest(requestId) {
  return api(`/friend-requests/${requestId}/cancel`, { method: 'PATCH' });
}

export function getFriends(userId) {
  return api(`/users/${userId}/friends`);
}

export function getFriendProfile(userId, friendId) {
  return api(`/users/${userId}/friends/${friendId}/profile`);
}

export function sendFriendStudyInvite(inviterId, inviteeId) {
  return api('/friend-study-invites', {
    method: 'POST',
    body: JSON.stringify({ inviter_id: inviterId, invitee_id: inviteeId }),
  });
}

export function getIncomingFriendStudyInvites(userId) {
  return api(`/users/${userId}/friend-study-invites/incoming`);
}

export function acceptFriendStudyInvite(inviteId) {
  return api(`/friend-study-invites/${inviteId}/accept`, { method: 'PATCH' });
}

export function rejectFriendStudyInvite(inviteId) {
  return api(`/friend-study-invites/${inviteId}/reject`, { method: 'PATCH' });
}

export function getFriendStudyRoom(roomId) {
  return api(`/friend-study-rooms/${roomId}`);
}
