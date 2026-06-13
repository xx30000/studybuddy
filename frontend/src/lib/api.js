const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000/api';

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || '請求失敗');
  return data;
}
