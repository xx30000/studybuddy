import React, { useEffect, useMemo, useState } from 'react';
import { Check, Flag, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  createTodo,
  deleteTodo,
  getTodos,
  syncTasksToTodos,
  updateTodo,
} from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

function formatDueTime(value) {
  if (!value) return '未設定期限';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default function TodayTodoList({
  currentUser,
  groupId = null,
  selectedTodoId = '',
  completedTodoId = null,
  setToast,
  onSelectTodo,
  onTodosChange,
}) {
  const [todos, setTodos] = useState([]);
  const [todoDraft, setTodoDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const activeTodos = useMemo(() => todos.filter((todo) => !todo.is_done), [todos]);

  function publishTodos(nextTodos) {
    setTodos(nextTodos);
    onTodosChange?.(nextTodos);
  }

  async function loadTodos({ keepSelection = false } = {}) {
    if (!currentUser?.id) return;
    setIsLoading(true);
    try {
      const data = await getTodos(currentUser.id, groupId);
      const list = data.todos || [];
      publishTodos(list);
      const focused = list.find((todo) => todo.is_focus && !todo.is_done);
      if (!keepSelection && focused) {
        onSelectTodo?.(focused);
      }
      if (!list.some((todo) => String(todo.id) === String(selectedTodoId))) {
        onSelectTodo?.(focused || null);
      }
    } catch (err) {
      setToast?.(err.message || '今日代辦載入失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    onSelectTodo?.(null);
    loadTodos();
  }, [currentUser?.id, groupId]);

  useEffect(() => {
    if (!completedTodoId) return;
    const nextTodos = todos.map((todo) => (
      String(todo.id) === String(completedTodoId)
        ? { ...todo, is_done: true, is_focus: false }
        : todo
    ));
    publishTodos(nextTodos);
  }, [completedTodoId]);

  async function handleAddTodo(event) {
    event.preventDefault();
    const title = todoDraft.trim();
    if (!title) {
      setToast?.('請輸入今日代辦內容', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const data = await createTodo(currentUser.id, {
        title,
        group_id: groupId || null,
        due_at: dueDraft || null,
      });
      const nextTodos = [...todos, data.todo].filter(Boolean);
      publishTodos(nextTodos);
      setTodoDraft('');
      setDueDraft('');
      onSelectTodo?.(data.todo);
      setToast?.(data.message || '已新增今日代辦', 'success');
      await loadTodos({ keepSelection: true });
    } catch (err) {
      setToast?.(err.message || '新增今日代辦失敗', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleTodoDone(todo) {
    try {
      const data = await updateTodo(todo.id, { is_done: !todo.is_done });
      const nextTodos = todos.map((item) => (item.id === todo.id ? data.todo : item));
      publishTodos(nextTodos);
      if (String(selectedTodoId) === String(todo.id)) {
        onSelectTodo?.(null);
      }
      setToast?.(data.message || '今日代辦已更新', 'success');
    } catch (err) {
      setToast?.(err.message || '更新今日代辦失敗', 'error');
    }
  }

  async function setFocusTodo(todo) {
    try {
      const data = await updateTodo(todo.id, { is_focus: !todo.is_focus });
      const nextTodos = todos.map((item) => {
        if (item.id === todo.id) return data.todo;
        return data.todo?.is_focus ? { ...item, is_focus: false } : item;
      });
      publishTodos(nextTodos);
      if (data.todo?.is_focus) {
        onSelectTodo?.(data.todo);
      }
      setToast?.(data.message || '今日代辦已更新', 'success');
    } catch (err) {
      setToast?.(err.message || '設定重點代辦失敗', 'error');
    }
  }

  async function removeTodo(todo) {
    try {
      const data = await deleteTodo(todo.id);
      const nextTodos = todos.filter((item) => item.id !== todo.id);
      publishTodos(nextTodos);
      if (String(selectedTodoId) === String(todo.id)) {
        onSelectTodo?.(null);
      }
      setToast?.(data.message || '已刪除今日代辦', 'success');
    } catch (err) {
      setToast?.(err.message || '刪除今日代辦失敗', 'error');
    }
  }

  async function handleSyncTasks() {
    if (!groupId) return;
    setIsSyncing(true);
    try {
      const data = await syncTasksToTodos(currentUser.id, groupId);
      setToast?.(data.message || '已同步分派任務', 'success');
      await loadTodos({ keepSelection: true });
    } catch (err) {
      setToast?.(err.message || '同步任務失敗', 'error');
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="today-todo-card">
      <div className="today-todo-header">
        <div>
          <h3 className="today-todo-title"><UiIcon name="task-list" /> 今日代辦清單</h3>
          <p className="today-todo-description">把今天要完成的事列出來，再選一件進入計時。</p>
        </div>
        {groupId && (
          <button
            type="button"
            className="today-todo-sync-button"
            onClick={handleSyncTasks}
            disabled={isSyncing}
          >
            <RotateCcw size={15} /> 同步分派任務
          </button>
        )}
      </div>

      <form className="quick-add-todo" onSubmit={handleAddTodo}>
        <input
          className="quick-add-todo-input"
          value={todoDraft}
          onChange={(event) => setTodoDraft(event.target.value)}
          placeholder="新增今日代辦，例如：整理簡報、修改 Class Diagram"
          disabled={isSaving}
        />
        <input
          className="today-todo-due-input"
          type="datetime-local"
          value={dueDraft}
          onChange={(event) => setDueDraft(event.target.value)}
          disabled={isSaving}
          aria-label="代辦期限"
        />
        <button className="quick-add-todo-button" type="submit" disabled={isSaving}>
          <Plus size={16} /> 新增
        </button>
      </form>

      <div className="today-todo-list">
        {isLoading && <p className="todo-select-loading">今日代辦載入中...</p>}
        {!isLoading && todos.length === 0 && (
          <p className="todo-select-empty">今天還沒有代辦。先新增一件想完成的小事吧。</p>
        )}
        {!isLoading && todos.map((todo, index) => (
          <article
            className={`today-todo-item ${todo.is_done ? 'done' : ''} ${todo.is_focus ? 'focus' : ''} ${todo.is_overdue ? 'overdue' : ''}`}
            key={todo.id}
          >
            <span className="today-todo-index">{index + 1}.</span>
            <button
              type="button"
              className={`today-todo-checkbox ${todo.is_done ? 'checked' : ''}`}
              onClick={() => toggleTodoDone(todo)}
              aria-label={todo.is_done ? '改成未完成' : '完成代辦'}
            >
              {todo.is_done && <Check size={15} />}
            </button>
            <button
              type="button"
              className={`today-todo-main ${String(selectedTodoId) === String(todo.id) ? 'selected' : ''}`}
              onClick={() => !todo.is_done && onSelectTodo?.(todo)}
              disabled={todo.is_done}
            >
              <strong>{todo.title}</strong>
              <small className="today-todo-meta">{formatDueTime(todo.due_at)}</small>
            </button>
            <div className="today-todo-badges">
              {todo.is_focus && <span className="today-todo-badge focus">重點</span>}
              {todo.is_done && <span className="today-todo-badge done">完成</span>}
              {todo.is_overdue && <span className="today-todo-badge overdue">逾期</span>}
              {todo.source_type === 'task' && <span className="today-todo-badge task">任務</span>}
            </div>
            <div className="today-todo-actions">
              {!todo.is_done && (
                <button
                  type="button"
                  className="today-todo-focus-button"
                  onClick={() => setFocusTodo(todo)}
                >
                  <Flag size={14} /> {todo.is_focus ? '取消重點' : '設為重點'}
                </button>
              )}
              <button
                type="button"
                className="today-todo-delete-button"
                onClick={() => removeTodo(todo)}
                aria-label="刪除代辦"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <p className="today-todo-helper">
        完成計時後不會自動勾完成，你可以依實際進度再標記。
      </p>
    </section>
  );
}
