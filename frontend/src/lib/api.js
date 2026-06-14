const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_DEBUG = import.meta.env.DEV && import.meta.env.VITE_API_DEBUG === '1';

export async function api(path, options = {}) {
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}/api${apiPath}`;
  const method = options.method || 'GET';

  if (API_DEBUG) {
    console.log('[API]', method, url);
  }

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || '請求失敗');
  return data;
}

function checkinQuery(groupId) {
  return groupId ? `?group_id=${groupId}` : '';
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
