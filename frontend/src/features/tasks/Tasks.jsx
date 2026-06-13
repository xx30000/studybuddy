import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { TASK_STATUS } from '../../lib/constants.js';
import { UiIcon } from '../../lib/icons.js';
import TaskRow from './TaskRow.jsx';

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
  return [`任務完成`, `獲得 ${data.coins_added} 金幣`].join('\n');
}

export default function Tasks({ session, members, tasks, refresh, setToast }) {
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
    if (!form.title.trim()) return setToast('請輸入任務名稱', 'error');

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
    setToast(`任務新增成功，獎勵為 ${data.task.coin_reward} 金幣`, 'success');
    refresh();
  }

  async function completeTask(id) {
    const data = await api(`/tasks/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: currentUser.id, status: TASK_STATUS.DONE }),
    });
    setToast(data.message || completionMessage(data), 'success');
    refresh();
  }

  async function toggleFeatured(task) {
    try {
      const nextValue = Number(task.is_featured) === 1 ? 0 : 1;
      const data = await api(`/tasks/${task.id}/featured`, {
        method: 'PUT',
        body: JSON.stringify({ user_id: currentUser.id, is_featured: nextValue }),
      });
      setToast(data.message || (nextValue ? '已設為重點任務' : '已取消重點任務'), 'success');
      refresh();
    } catch (err) {
      setToast(err.message || '更新重點任務失敗', 'error');
    }
  }

  return (
    <div className="page-stack">
      <section className="white-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="check" className="section-icon" />全部任務</div>
        <div className="task-list-soft">
          {tasks.map((task) => (
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
          {!tasks.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="sprout" className="empty-icon" />
              <p>目前還沒有任務</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="flag" className="section-icon" />我的任務</div>
        <div className="task-list-soft">
          {myTasks.map((task) => (
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
          {!myTasks.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="check" className="empty-icon" />
              <p>目前沒有分派給你的任務</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card form-card task-section home-card">
        <div className="section-title blue task-page-title"><span /><UiIcon name="pencil" className="section-icon" />分派新任務</div>
        <form onSubmit={createTask}>
          <input
            placeholder="任務名稱"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            placeholder="任務說明"
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
            <UiIcon name="coin" /> 任務金幣由系統隨機設定
          </div>
          <label className="feature-checkbox">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
            />
            <UiIcon name="star" /> 顯示在首頁重點任務
          </label>
          <button className="primary-btn compact" type="submit">
            <Plus size={18} /> 新增任務
          </button>
        </form>
      </section>
    </div>
  );
}
