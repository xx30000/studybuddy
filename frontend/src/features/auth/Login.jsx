import React, { useState } from 'react';
import { BookOpenCheck, Eye, EyeOff, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

const emptyLogin = { email: '', password: '' };
const emptyRegister = { nickname: '', email: '', password: '', confirmPassword: '' };

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [message, setMessage] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

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
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
        }),
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
      <div className="study-decor decor-note">Note</div>
      <div className="study-decor decor-pencil" />
      <div className="study-decor decor-book"><BookOpenCheck size={34} /></div>
      <div className="study-decor decor-star"><Sparkles size={28} /></div>

      <main className="login-castle-card auth-card">
        <div className="logo-circle study-logo">
          <img src="/images/studybuddy-logo.jpg" alt="StudyBuddy logo" className="study-logo-image" />
        </div>
        <h1 className="login-title app-title brand-en-title">StudyBuddy</h1>
        <p className="subtitle">一起讀書、完成任務、累積金幣，解鎖你們的國庫獎勵。</p>

        {message && <p className="error-text auth-message"><UiIcon name="bell" /> {message}</p>}

        {!isRegister ? (
          <form onSubmit={submitLogin} className="castle-form">
            <label className="icon-meta"><UiIcon name="mail" /> Email</label>
            <input type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="you@example.com" />
            <label className="icon-meta"><UiIcon name="key" /> 密碼</label>
            <div className="password-input-wrap">
              <input
                className="password-input"
                type={showLoginPassword ? 'text' : 'password'}
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="請輸入密碼"
                autoComplete="current-password"
              />
              <button
                className="password-toggle-button"
                type="button"
                onClick={() => setShowLoginPassword((value) => !value)}
                aria-label={showLoginPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="primary-btn" type="submit"><UiIcon name="check" /> 登入</button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="castle-form">
            <label className="icon-meta"><UiIcon name="heart" /> 暱稱</label>
            <input value={registerForm.nickname} onChange={(e) => setRegisterForm({ ...registerForm, nickname: e.target.value })} placeholder="你的共讀暱稱" />
            <label className="icon-meta"><UiIcon name="mail" /> Email</label>
            <input type="email" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} placeholder="you@example.com" />
            <label className="icon-meta"><UiIcon name="key" /> 密碼</label>
            <div className="password-input-wrap">
              <input
                className="password-input"
                type={showRegisterPassword ? 'text' : 'password'}
                value={registerForm.password}
                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                placeholder="請輸入密碼"
                autoComplete="new-password"
              />
              <button
                className="password-toggle-button"
                type="button"
                onClick={() => setShowRegisterPassword((value) => !value)}
                aria-label={showRegisterPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <label className="icon-meta"><UiIcon name="check" /> 確認密碼</label>
            <div className="password-input-wrap">
              <input
                className="password-input"
                type={showRegisterConfirmPassword ? 'text' : 'password'}
                value={registerForm.confirmPassword}
                onChange={(e) => setRegisterForm({ ...registerForm, confirmPassword: e.target.value })}
                placeholder="再次輸入密碼"
                autoComplete="new-password"
              />
              <button
                className="password-toggle-button"
                type="button"
                onClick={() => setShowRegisterConfirmPassword((value) => !value)}
                aria-label={showRegisterConfirmPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showRegisterConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="primary-btn" type="submit"><UiIcon name="check" /> 註冊</button>
          </form>
        )}

        <p className="auth-switch">
          {!isRegister ? '還沒有帳號？' : '已經有帳號？'}
          <button type="button" onClick={() => switchMode(isRegister ? 'login' : 'register')}>
            {!isRegister ? '建立帳號' : '回到登入'}
          </button>
        </p>
      </main>
    </div>
  );
}
