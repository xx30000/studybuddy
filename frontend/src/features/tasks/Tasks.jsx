import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { TASK_STATUS } from '../../lib/constants.js';
import TaskRow from './TaskRow.jsx';

const TASK_REWARDS = [20, 25, 30, 35, 40, 45, 50];

function randomReward() {
  return TASK_REWARDS[Math.floor(Math.random() * TASK_REWARDS.length)];
}

function isCompleted(task) {
  const status = String(task.status || '');
  return status === TASK_STATUS.DONE || status === 'done' || status.includes('完成');
}

function isAssignedToCurrentUser(task, currentUser) {
  const assignedId = task.assigned_to ?? task.assignedTo;
  const assignedName = task.assigned_name ?? task.assignedName;
  const currentName = currentUser.nickname || currentUser.name;

  return String(assignedId) === String(currentUser.id) || assignedName === currentName;
}

function completionMessage(data) {
  return [`任務完成！`, `獲得 ${data.coins_added} 金幣`].join('\n');
}

export default function Tasks({ session, members, tasks, refresh, setToast }) {
  const currentUser = session.user;
  const defaultMember = members[0]?.id || currentUser.id;
  const [form, setForm] = useState({
    title: '',
    description: '',
    assigned_to: defaultMember,
    deadline: '',
    reward: randomReward(),
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
    if (!form.title.trim()) return setToast('請輸入任務名稱');

    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        status: TASK_STATUS.PENDING,
        group_id: session.group.id,
        created_by: currentUser.id,
      }),
    });
    setForm({ title: '', description: '', assigned_to: defaultMember, deadline: '', reward: randomReward() });
    setToast('已分派新任務');
    refresh();
  }

  async function completeTask(id) {
    const data = await api(`/tasks/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: currentUser.id, status: TASK_STATUS.DONE }),
    });
    setToast(completionMessage(data));
    refresh();
  }

  return (
    <div className="page-stack">
      <section className="white-card">
        <div className="section-title blue"><span />全部專題任務</div>
        <div className="task-list-soft">
          {tasks.map((task) => (
            <TaskRow
              task={task}
              key={task.id}
              done={isCompleted(task)}
              showAssignee
              showCompleteAction={false}
            />
          ))}
          {!tasks.length && <p className="empty-text">目前還沒有任何任務</p>}
        </div>
      </section>

      <section className="white-card">
        <div className="section-title blue"><span />我的任務</div>
        <div className="task-list-soft">
          {myTasks.map((task) => (
            <TaskRow
              task={task}
              key={task.id}
              done={isCompleted(task)}
              onComplete={completeTask}
              showCompleteAction
            />
          ))}
          {!myTasks.length && <p className="empty-text">目前沒有分派給你的任務</p>}
        </div>
      </section>

      <section className="white-card form-card">
        <div className="section-title blue"><span />分派新任務</div>
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
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
          <div className="readonly-reward">
            本次任務獎勵：{form.reward} 金幣
          </div>
          <button className="primary-btn compact" type="submit">
            <Plus size={18} /> 分派任務
          </button>
        </form>
      </section>
    </div>
  );
}
