import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { TASK_STATUS } from '../../lib/constants.js';
import { UiIcon } from '../../lib/icons.js';
import TaskRow from './TaskRow.jsx';

const TEXT = {
  taskCompleted: '任務已完成',
  gainedCoins: '獲得',
  coins: '金幣',
  titleRequired: '請輸入任務名稱',
  taskCreated: '任務已新增',
  rewardPrefix: '獲得獎勵',
  setFeaturedFailed: '重點任務設定失敗',
  allTasks: '全部任務',
  myTasks: '我的任務',
  newTask: '新增任務',
  noTasks: '目前還沒有任務',
  noMyTasks: '目前沒有指派給你的任務',
  taskTitlePlaceholder: '任務名稱',
  taskDescriptionPlaceholder: '任務說明',
  rewardNotice: '任務金幣獎勵由系統自動分配',
  showOnHome: '顯示在首頁重點任務',
  submit: '新增任務',
};

function isCompleted(task) {
  return Number(task.is_completed) === 1 || String(task.status || '') === TASK_STATUS.DONE;
}

function isAssignedToCurrentUser(task, currentUser) {
  const assignedId = task.assigned_to ?? task.assignedTo;
  const assignedName = task.assigned_name ?? task.assignedName;
  const currentName = currentUser.nickname || currentUser.name;

  return String(assignedId) === String(currentUser.id) || assignedName === currentName;
}

function completionMessage(data) {
  return [`${TEXT.taskCompleted}`, `${TEXT.gainedCoins} ${data.coins_added} ${TEXT.coins}`].join('\n');
}

export default function Tasks({ session, members, tasks, refresh, setToast, isLoading = false, hasLoaded = false }) {
  const currentUser = session.user;
  const defaultMember = members[0]?.id || currentUser.id;
  const [form, setForm] = useState({
    title: '',
    description: '',
    assigned_to: defaultMember,
    due_date: '',
    is_featured: false,
  });

  const myTasks = useMemo(
    () => tasks.filter((task) => isAssignedToCurrentUser(task, currentUser)),
    [tasks, currentUser.id, currentUser.nickname, currentUser.name],
  );

  useEffect(() => {
    if (!form.assigned_to && defaultMember) {
      setForm((prev) => ({ ...prev, assigned_to: defaultMember }));
    }
  }, [defaultMember, form.assigned_to]);

  async function createTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return setToast(TEXT.titleRequired, 'error');

    const data = await api(`/groups/${session.group.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        due_date: form.due_date,
        assigned_to: form.assigned_to,
        created_by: currentUser.id,
        is_featured: form.is_featured ? 1 : 0,
      }),
    });
    setForm({ title: '', description: '', assigned_to: defaultMember, due_date: '', is_featured: false });
    setToast(`${TEXT.taskCreated}\n${TEXT.rewardPrefix} ${data.task.coin_reward} ${TEXT.coins}`, 'success', `task-created:${currentUser.id}:${data.task.id}`);
    refresh();
  }

  async function completeTask(id) {
    const data = await api(`/tasks/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: currentUser.id, status: TASK_STATUS.DONE }),
    });
    setToast(data.message || completionMessage(data), 'success', `task-completed:${currentUser.id}:${id}`);
    refresh();
  }

  async function toggleFeatured(task) {
    try {
      const nextValue = Number(task.is_featured) === 1 ? 0 : 1;
      const data = await api(`/tasks/${task.id}/featured`, {
        method: 'PUT',
        body: JSON.stringify({ user_id: currentUser.id, is_featured: nextValue }),
      });
      setToast(data.message || (nextValue ? '已設為重點任務' : '已取消重點任務'), 'success', `task-featured:${currentUser.id}:${task.id}:${nextValue}`);
      refresh();
    } catch (err) {
      setToast(err.message || TEXT.setFeaturedFailed, 'error');
    }
  }

  const isInitialLoading = isLoading && !hasLoaded;

  return (
    <div className="page-stack">
      <section className="white-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="check" className="section-icon" />{TEXT.allTasks}</div>
        <div className="task-list-soft">
          {isInitialLoading && <div className="loading-hint">{TEXT.tasksLoading}</div>}
          {!isInitialLoading && tasks.map((task) => (
            <TaskRow
              task={task}
              key={task.id}
              done={isCompleted(task)}
              showAssignee
              showCompleteAction={false}
              currentUserId={currentUser.id}
              onToggleFeatured={toggleFeatured}
            />
          ))}
          {!isInitialLoading && hasLoaded && !tasks.length && (
            <div className="empty-text empty-with-icon empty-hint">
              <UiIcon name="sprout" className="empty-icon" />
              <p>{TEXT.noTasks}</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="flag" className="section-icon" />{TEXT.myTasks}</div>
        <div className="task-list-soft">
          {isInitialLoading && <div className="loading-hint">{TEXT.myTasksLoading}</div>}
          {!isInitialLoading && myTasks.map((task) => (
            <TaskRow
              task={task}
              key={task.id}
              done={isCompleted(task)}
              onComplete={completeTask}
              showCompleteAction
              currentUserId={currentUser.id}
              onToggleFeatured={toggleFeatured}
            />
          ))}
          {!isInitialLoading && hasLoaded && !myTasks.length && (
            <div className="empty-text empty-with-icon empty-hint">
              <UiIcon name="check" className="empty-icon" />
              <p>{TEXT.noMyTasks}</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card form-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="pencil" className="section-icon" />{TEXT.newTask}</div>
        <form onSubmit={createTask}>
          <input
            placeholder={TEXT.taskTitlePlaceholder}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            placeholder={TEXT.taskDescriptionPlaceholder}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="two-inputs">
            <select
              value={form.assigned_to}
              onChange={(e) => setForm({ ...form, assigned_to: Number(e.target.value) })}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.nickname}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          <div className="readonly-reward">
            <UiIcon name="coin" /> {TEXT.rewardNotice}
          </div>
          <label className="feature-checkbox">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
            />
            <UiIcon name="star" /> {TEXT.showOnHome}
          </label>
          <button className="primary-btn compact" type="submit">
            <Plus size={18} /> {TEXT.submit}
          </button>
        </form>
      </section>
    </div>
  );
}
