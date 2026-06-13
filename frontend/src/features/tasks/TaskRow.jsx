import React from 'react';
import { UiIcon } from '../../lib/icons.js';

const TEXT = {
  completed: '已完成',
  pending: '進行中',
  unknownAssignee: '未指派',
  unknownCreator: '未知',
  unsetDueDate: '未設定',
  featured: '重點任務',
  noDescription: '沒有任務說明',
  assignee: '指派給',
  creator: '建立者',
  due: '截止',
  coins: '金幣',
  setFeatured: '設為重點',
  unsetFeatured: '取消重點',
  completeTask: '完成任務',
};

export default function TaskRow({
  task,
  onComplete,
  onToggleFeatured,
  currentUserId,
  done = false,
  showAssignee = false,
  showCompleteAction = false,
}) {
  const statusText = done ? TEXT.completed : TEXT.pending;
  const assignee = task.assigned_to_nickname || task.assigned_name || task.assignedName || TEXT.unknownAssignee;
  const creator = task.created_by_nickname || TEXT.unknownCreator;
  const dueDate = task.due_date || task.deadline || TEXT.unsetDueDate;
  const reward = task.coin_reward ?? task.reward ?? 0;
  const isFeatured = Number(task.is_featured) === 1;
  const canToggleFeatured = String(task.created_by) === String(currentUserId);

  return (
    <article className={`soft-row task-row ${done ? 'completed' : ''}`}>
      <div className="check-box task-checkbox task-check-box task-complete-box">{done ? <UiIcon name="check" /> : ''}</div>

      <div className="row-main">
        <div className="task-title-line">
          <h3 className="icon-title task-card-title"><UiIcon name="check" /> {task.title}</h3>
          {isFeatured && <span className="featured-pill"><UiIcon name="star" /> {TEXT.featured}</span>}
          <span className={done ? 'task-status task-status-badge status-badge done' : 'task-status task-status-badge status-badge pending'}>
            <UiIcon name={done ? 'check' : 'hourglass'} /> {statusText}
          </span>
        </div>
        <p className="task-card-description">{task.description || TEXT.noDescription}</p>
        <small className="icon-row task-card-meta">
          {showAssignee && <>{TEXT.assignee}{assignee} ? </>}
          {TEXT.creator}{creator} ? <UiIcon name="alarm" /> {TEXT.due} {dueDate}
        </small>
      </div>

      <div className="row-action">
        <b className="icon-meta task-coin-reward coin-reward"><UiIcon name="coin" /> {reward} {TEXT.coins}</b>
        {canToggleFeatured && (
          <button
            className="task-action-button featured-task-button task-featured-btn feature-toggle-btn"
            type="button"
            onClick={() => onToggleFeatured?.(task)}
          >
            {isFeatured ? TEXT.unsetFeatured : TEXT.setFeatured}
          </button>
        )}
        {showCompleteAction && (
          done
            ? <span className="approved icon-meta"><UiIcon name="check" /> {TEXT.completed}</span>
            : <button className="task-action-button complete-task-button task-complete-btn" type="button" onClick={() => onComplete(task.id)}>{TEXT.completeTask}</button>
        )}
      </div>
    </article>
  );
}
