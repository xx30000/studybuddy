import React, { useState } from 'react';
import { BookOpenCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';

const emptyLogin = { email: '', password: '' };
const emptyRegister = { nickname: '', email: '', password: '', confirmPassword: '' };

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [message, setMessage] = useState('');

  const isRegister = mode === 'register';

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage('');
  }

  function validateEmail(email) {
    return email.includes('@');
  }

  async function submitLogin(e) {
    e.preventDefault();
    setMessage('');

    if (!loginForm.email.trim() || !loginForm.password) {
      setMessage('欄位不可空白');
      return;
    }
    if (!validateEmail(loginForm.email)) {
      setMessage('Email 格式不正確');
      return;
    }

    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });
      onLogin({ user: data.user, group: null });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function submitRegister(e) {
    e.preventDefault();
    setMessage('');

    const { nickname, email, password, confirmPassword } = registerForm;
    if (!nickname.trim() || !email.trim() || !password || !confirmPassword) {
      setMessage('欄位不可空白');
      return;
    }
    if (!validateEmail(email)) {
      setMessage('Email 格式不正確');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('密碼與確認密碼不一致');
      return;
    }

    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ nickname: nickname.trim(), email: email.trim(), password }),
      });
      onLogin({ user: data.user, group: null });
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="cloud-page login-cloud study-login-page">
      <div className="paper-grid" />
      <div className="study-decor decor-note">專題</div>
      <div className="study-decor decor-pencil" />
      <div className="study-decor decor-book"><BookOpenCheck size={34} /></div>
      <div className="study-decor decor-star"><Sparkles size={28} /></div>

      <main className="login-castle-card auth-card">
        <div className="logo-circle study-logo">
          <BookOpenCheck size={58} />
          <span className="mini-crown"><Sparkles size={28} /></span>
        </div>
        <h1 className="app-title">一起讀書監督</h1>
        <p className="subtitle">和夥伴一起完成專題，累積每一次努力</p>

        {message && <p className="error-text auth-message">{message}</p>}

        {!isRegister ? (
          <form onSubmit={submitLogin} className="castle-form">
            <label>Email</label>
            <input
              type="email"
              value={loginForm.email}
              onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              placeholder="you@example.com"
            />

            <label>密碼</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              placeholder="請輸入密碼"
            />

            <button className="primary-btn" type="submit">登入</button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="castle-form">
            <label>暱稱</label>
            <input
              value={registerForm.nickname}
              onChange={(e) => setRegisterForm({ ...registerForm, nickname: e.target.value })}
              placeholder="你的共讀暱稱"
            />

            <label>Email</label>
            <input
              type="email"
              value={registerForm.email}
              onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
              placeholder="you@example.com"
            />

            <label>密碼</label>
            <input
              type="password"
              value={registerForm.password}
              onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
              placeholder="請輸入密碼"
            />

            <label>確認密碼</label>
            <input
              type="password"
              value={registerForm.confirmPassword}
              onChange={(e) => setRegisterForm({ ...registerForm, confirmPassword: e.target.value })}
              placeholder="再輸入一次密碼"
            />

            <button className="primary-btn" type="submit">註冊</button>
          </form>
        )}

        <p className="auth-switch">
          {!isRegister ? '還沒有帳號嗎？' : '已經有帳號了？'}
          <button type="button" onClick={() => switchMode(isRegister ? 'login' : 'register')}>
            {!isRegister ? '立即註冊' : '返回登入'}
          </button>
        </p>
      </main>
    </div>
  );
}
