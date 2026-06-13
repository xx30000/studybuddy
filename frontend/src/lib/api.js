const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export async function api(path, options = {}) {
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${API_BASE_URL}/api${apiPath}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || '請求失敗');
  return data;
}
