import React from 'react';
import { UiIcon } from '../../lib/icons.js';

export default function TaskRow({
  task,
  onComplete,
  onToggleFeatured,
  currentUserId,
  done = false,
  showAssignee = false,
  showCompleteAction = false,
}) {
  const statusText = done ? '已完成' : '進行中';
  const assignee = task.assigned_to_nickname || task.assigned_name || task.assignedName || '未指定';
  const creator = task.created_by_nickname || '夥伴';
  const dueDate = task.due_date || task.deadline || '未設定';
  const reward = task.coin_reward ?? task.reward ?? 0;
  const isFeatured = Number(task.is_featured) === 1;
  const canToggleFeatured = String(task.created_by) === String(currentUserId);

  return (
    <article className={`soft-row task-row ${done ? 'completed' : ''}`}>
      <div className="check-box task-checkbox task-check-box task-complete-box">{done ? <UiIcon name="check" /> : ''}</div>

      <div className="row-main">
        <div className="task-title-line">
          <h3 className="icon-title task-card-title"><UiIcon name="check" /> {task.title}</h3>
          {isFeatured && <span className="featured-pill"><UiIcon name="star" /> 重點任務</span>}
          <span className={done ? 'task-status task-status-badge status-badge done' : 'task-status task-status-badge status-badge pending'}>
            <UiIcon name={done ? 'check' : 'hourglass'} /> {statusText}
          </span>
        </div>
        <p className="task-card-description">{task.description || '沒有任務說明'}</p>
        <small className="icon-row task-card-meta">
          {showAssignee && <>分派給 {assignee} ｜ </>}
          建立者 {creator} ｜ <UiIcon name="alarm" /> 截止 {dueDate}
        </small>
      </div>

      <div className="row-action">
        <b className="icon-meta task-coin-reward coin-reward"><UiIcon name="coin" /> {reward} 金幣</b>
        {canToggleFeatured && (
          <button
            className="task-action-button featured-task-button task-featured-btn feature-toggle-btn"
            type="button"
            onClick={() => onToggleFeatured?.(task)}
          >
            {isFeatured ? '取消重點' : '設為重點'}
          </button>
        )}
        {showCompleteAction && (
          done
            ? <span className="approved icon-meta"><UiIcon name="check" /> 已完成</span>
            : <button className="task-action-button complete-task-button task-complete-btn" type="button" onClick={() => onComplete(task.id)}>完成任務</button>
        )}
      </div>
    </article>
  );
}
