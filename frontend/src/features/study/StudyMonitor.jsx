import React, { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, SquareCheckBig } from 'lucide-react';
import { api } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

function formatSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function summaryQuery(groupId) {
  return groupId ? `?group_id=${groupId}` : '';
}

export default function StudyMonitor({
  session,
  currentGroup = null,
  refresh,
  setToast,
  onUserCoinsUpdated,
}) {
  const currentUser = session?.user;
  const groupId = currentGroup?.id || null;
  const [studySubject, setStudySubject] = useState('');
  const [studyTimerStatus, setStudyTimerStatus] = useState('idle');
  const [studyStartTime, setStudyStartTime] = useState(null);
  const [pausedAt, setPausedAt] = useState(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [studyElapsedSeconds, setStudyElapsedSeconds] = useState(0);
  const [todaySummary, setTodaySummary] = useState({ total_minutes: 0, total_sessions: 0 });
  const [weekSummary, setWeekSummary] = useState({ total_minutes: 0, total_sessions: 0 });
  const [studyRanking, setStudyRanking] = useState([]);

  const modeLabel = groupId ? '群組讀書模式' : '個人讀書模式';
  const rewardPreview = useMemo(() => Math.floor(Math.floor(studyElapsedSeconds / 60) / 10) * 5, [studyElapsedSeconds]);

  async function loadStudyData() {
    if (!currentUser?.id) return;
    const query = summaryQuery(groupId);
    const [today, week] = await Promise.all([
      api(`/users/${currentUser.id}/study-summary/today${query}`),
      api(`/users/${currentUser.id}/study-summary/week${query}`),
    ]);
    setTodaySummary({
      total_minutes: today.total_minutes || 0,
      total_sessions: today.total_sessions || 0,
    });
    setWeekSummary({
      total_minutes: week.total_minutes || 0,
      total_sessions: week.total_sessions || 0,
    });

    if (groupId) {
      const ranking = await api(`/groups/${groupId}/study-ranking/week`);
      setStudyRanking(ranking.ranking || []);
    } else {
      setStudyRanking([]);
    }
  }

  useEffect(() => {
    loadStudyData().catch((err) => setToast?.(err.message || '讀書統計載入失敗', 'error'));
  }, [currentUser?.id, groupId]);

  useEffect(() => {
    if (studyTimerStatus !== 'running' || !studyStartTime) return undefined;
    const intervalId = window.setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - studyStartTime.getTime()) / 1000) - pausedSeconds);
      setStudyElapsedSeconds(seconds);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [studyTimerStatus, studyStartTime, pausedSeconds]);

  function startTimer() {
    if (!studySubject.trim()) {
      setToast?.('請先輸入今天要讀的主題', 'error');
      return;
    }
    setStudyStartTime(new Date());
    setPausedAt(null);
    setPausedSeconds(0);
    setStudyElapsedSeconds(0);
    setStudyTimerStatus('running');
  }

  function pauseTimer() {
    setPausedAt(new Date());
    setStudyTimerStatus('paused');
  }

  function resumeTimer() {
    if (pausedAt) {
      setPausedSeconds((seconds) => seconds + Math.floor((Date.now() - pausedAt.getTime()) / 1000));
    }
    setPausedAt(null);
    setStudyTimerStatus('running');
  }

  function resetTimer() {
    setStudyTimerStatus('idle');
    setStudyStartTime(null);
    setPausedAt(null);
    setPausedSeconds(0);
    setStudyElapsedSeconds(0);
  }

  async function finishTimer() {
    if (!studyStartTime) return;
    const endTime = new Date();
    const effectiveSeconds = studyTimerStatus === 'paused'
      ? studyElapsedSeconds
      : Math.max(0, Math.floor((endTime.getTime() - studyStartTime.getTime()) / 1000) - pausedSeconds);
    if (effectiveSeconds < 60) {
      setToast?.('至少讀滿 1 分鐘才能完成記錄', 'error');
      return;
    }

    try {
      const adjustedStartTime = new Date(endTime.getTime() - effectiveSeconds * 1000);
      const data = await api('/study-sessions', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUser.id,
          group_id: groupId,
          subject: studySubject.trim(),
          start_time: adjustedStartTime.toISOString(),
          end_time: endTime.toISOString(),
        }),
      });
      setToast?.(data.message || '讀書記錄已完成', 'success');
      onUserCoinsUpdated?.(data.session?.user_coins);
      setStudySubject('');
      resetTimer();
      await loadStudyData();
      refresh?.();
    } catch (err) {
      setToast?.(err.message || '讀書記錄儲存失敗', 'error');
    }
  }

  return (
    <section className="study-monitor-card home-card">
      <div className="study-monitor-header">
        <div>
          <small className="icon-meta"><UiIcon name="hourglass" /> {modeLabel}</small>
          <h2 className="study-monitor-title">
            <UiIcon name="cat-book" className="section-icon" />
            讀書監督
          </h2>
        </div>
        <div className="study-reward-preview">
          <UiIcon name="coin" />
          預計 {rewardPreview} 金幣
        </div>
      </div>

      <label className="study-subject-label" htmlFor="study-subject">今天要讀什麼？</label>
      <input
        id="study-subject"
        className="study-subject-input"
        value={studySubject}
        disabled={studyTimerStatus !== 'idle'}
        onChange={(event) => setStudySubject(event.target.value)}
        placeholder="例如：系統分析、登入測試、Class Diagram"
      />

      <div className="study-timer-display" aria-live="polite">{formatSeconds(studyElapsedSeconds)}</div>

      <div className="study-timer-actions">
        {studyTimerStatus === 'idle' && (
          <button className="study-timer-button start" type="button" onClick={startTimer}>
            <Play size={18} /> 開始
          </button>
        )}
        {studyTimerStatus === 'running' && (
          <button className="study-timer-button pause" type="button" onClick={pauseTimer}>
            <Pause size={18} /> 暫停
          </button>
        )}
        {studyTimerStatus === 'paused' && (
          <button className="study-timer-button start" type="button" onClick={resumeTimer}>
            <Play size={18} /> 繼續
          </button>
        )}
        {studyTimerStatus !== 'idle' && (
          <>
            <button className="study-timer-button finish" type="button" onClick={finishTimer}>
              <SquareCheckBig size={18} /> 完成
            </button>
            <button className="study-timer-button reset" type="button" onClick={resetTimer}>
              <RotateCcw size={18} /> 重置
            </button>
          </>
        )}
      </div>

      <div className="study-summary-row">
        <div>
          <span>今日讀書</span>
          <strong>{todaySummary.total_minutes}</strong>
          <small>分鐘 / {todaySummary.total_sessions} 次</small>
        </div>
        <div>
          <span>本週累計</span>
          <strong>{weekSummary.total_minutes}</strong>
          <small>分鐘 / {weekSummary.total_sessions} 次</small>
        </div>
      </div>

      {groupId && (
        <div className="study-ranking-card">
          <b><UiIcon name="crown" /> 本週共讀排行榜</b>
          <div className="study-ranking-list">
            {studyRanking.map((item) => (
              <div className="study-ranking-item" key={item.user_id}>
                <span>{item.rank}</span>
                <strong>{item.nickname}</strong>
                <small>{item.total_minutes} 分鐘 / {item.total_sessions} 次</small>
              </div>
            ))}
            {!studyRanking.length && <p className="empty-text">本週還沒有讀書記錄</p>}
          </div>
        </div>
      )}
    </section>
  );
}
