import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pause, Play, RotateCcw, SquareCheckBig } from 'lucide-react';
import { api, updateTodo } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';
import TodayTodoList from './TodayTodoList.jsx';

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
  const [selectedTodo, setSelectedTodo] = useState(null);
  const [todos, setTodos] = useState([]);
  const [completedTodoId, setCompletedTodoId] = useState(null);
  const [todoCompletePrompt, setTodoCompletePrompt] = useState(null);
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
  const studySubject = selectedTodo?.title || '';
  const activeTodos = useMemo(() => todos.filter((todo) => !todo.is_done), [todos]);

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
    setSelectedTodo(null);
    setTodoCompletePrompt(null);
    setCompletedTodoId(null);
  }, [currentUser?.id, groupId]);

  useEffect(() => {
    if (studyTimerStatus !== 'running' || !studyStartTime) return undefined;
    const intervalId = window.setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - studyStartTime.getTime()) / 1000) - pausedSeconds);
      setStudyElapsedSeconds(seconds);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [studyTimerStatus, studyStartTime, pausedSeconds]);

  function handleSelectTodo(todo) {
    if (studyTimerStatus !== 'idle') {
      setToast?.('讀書計時進行中，結束或重設後才能更換今日重點。', 'error');
      return;
    }
    setSelectedTodo(todo);
    setTodoCompletePrompt(null);
    if (todo?.title) {
      setToast?.('已選擇今日讀書重點', 'success');
    }
  }

  function handleTimerTodoChange(event) {
    const nextTodo = activeTodos.find((todo) => String(todo.id) === String(event.target.value));
    handleSelectTodo(nextTodo || null);
  }

  function handleTodosChange(nextTodos) {
    setTodos(nextTodos || []);
    if (selectedTodo?.id && !nextTodos?.some((todo) => String(todo.id) === String(selectedTodo.id) && !todo.is_done)) {
      setSelectedTodo(null);
    }
  }

  function startTimer() {
    if (!selectedTodo?.title) {
      setToast?.('請先選擇一件今日代辦', 'error');
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

  async function markPromptTodoDone() {
    if (!todoCompletePrompt?.id) return;
    try {
      const data = await updateTodo(todoCompletePrompt.id, { is_done: true });
      setCompletedTodoId(data.todo?.id || todoCompletePrompt.id);
      if (String(selectedTodo?.id) === String(todoCompletePrompt.id)) {
        setSelectedTodo(null);
      }
      setTodoCompletePrompt(null);
      setToast?.(data.message || '已完成今日代辦', 'success');
    } catch (err) {
      setToast?.(err.message || '更新今日代辦失敗', 'error');
    }
  }

  async function finishTimer() {
    if (!studyStartTime) return;
    const endTime = new Date();
    const effectiveSeconds = studyTimerStatus === 'paused'
      ? studyElapsedSeconds
      : Math.max(0, Math.floor((endTime.getTime() - studyStartTime.getTime()) / 1000) - pausedSeconds);
    if (effectiveSeconds < 60) {
      setToast?.('至少讀書 1 分鐘才會儲存紀錄', 'error');
      return;
    }

    try {
      const adjustedStartTime = new Date(endTime.getTime() - effectiveSeconds * 1000);
      const finishedTodo = selectedTodo;
      const data = await api('/study-sessions', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUser.id,
          group_id: groupId,
          todo_id: finishedTodo?.id || null,
          subject: finishedTodo?.title || '',
          start_time: adjustedStartTime.toISOString(),
          end_time: endTime.toISOString(),
        }),
      });
      setToast?.(data.message || '讀書紀錄已完成', 'success');
      onUserCoinsUpdated?.(data.session?.user_coins);
      setTodoCompletePrompt(finishedTodo || null);
      resetTimer();
      await loadStudyData();
      refresh?.();
    } catch (err) {
      setToast?.(err.message || '讀書紀錄儲存失敗', 'error');
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

      <TodayTodoList
        currentUser={currentUser}
        groupId={groupId}
        selectedTodoId={selectedTodo?.id || ''}
        completedTodoId={completedTodoId}
        setToast={setToast}
        onSelectTodo={handleSelectTodo}
        onTodosChange={handleTodosChange}
      />

      <div className="study-timer-card">
        <div className="study-timer-card-header">
          <h3 className="study-timer-title">
            <UiIcon name="hourglass" /> 計時
          </h3>
          <span className="study-timer-mode">{studyTimerStatus === 'idle' ? '準備中' : '進行中'}</span>
        </div>

        <label className="study-timer-label" htmlFor="study-timer-todo">
          今天要讀哪一件？
        </label>
        <select
          id="study-timer-todo"
          className="study-timer-select"
          value={selectedTodo?.id || ''}
          onChange={handleTimerTodoChange}
          disabled={studyTimerStatus !== 'idle'}
        >
          <option value="">選擇一件未完成代辦</option>
          {activeTodos.map((todo) => (
            <option key={todo.id} value={todo.id}>
              {todo.is_focus ? '★ ' : ''}{todo.title}
            </option>
          ))}
        </select>

        <div className="study-timer-current">
          <span className="study-timer-current-label">本次計時目標</span>
          <strong className="study-timer-current-text">{studySubject || '尚未選擇代辦'}</strong>
        </div>

        {todoCompletePrompt && (
          <div className="todo-complete-after-session">
            <div>
              <span>剛剛讀的是</span>
              <strong>{todoCompletePrompt.title}</strong>
            </div>
            <button type="button" onClick={markPromptTodoDone}>
              <Check size={16} /> 完成此代辦
            </button>
          </div>
        )}

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
                <RotateCcw size={18} /> 重設
              </button>
            </>
          )}
        </div>
      </div>

      <div className="study-summary-row">
        <div>
          <span>今日讀書</span>
          <strong>{todaySummary.total_minutes}</strong>
          <small>分鐘 / {todaySummary.total_sessions} 次</small>
        </div>
        <div>
          <span>本週累積</span>
          <strong>{weekSummary.total_minutes}</strong>
          <small>分鐘 / {weekSummary.total_sessions} 次</small>
        </div>
      </div>

      {groupId && (
        <div className="study-ranking-card">
          <b><UiIcon name="crown" /> 本週讀書排行</b>
          <div className="study-ranking-list">
            {studyRanking.map((item) => (
              <div className="study-ranking-item" key={item.user_id}>
                <span>{item.rank}</span>
                <strong>{item.nickname}</strong>
                <small>{item.total_minutes} 分鐘 / {item.total_sessions} 次</small>
              </div>
            ))}
            {!studyRanking.length && <p className="empty-text">本週還沒有讀書紀錄</p>}
          </div>
        </div>
      )}
    </section>
  );
}
