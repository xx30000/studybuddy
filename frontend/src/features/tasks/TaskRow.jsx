import React from 'react';

export default function TaskRow({
  task,
  onComplete,
  done = false,
  showAssignee = false,
  showCompleteAction = false,
}) {
  const statusText = done ? '已完成' : '進行中';
  const assignee = task.assigned_name || task.assignedName || '未指派';

  return (
    <article className={`soft-row task-row ${done ? 'completed' : ''}`}>
      <div className="check-box">{done ? '✓' : ''}</div>

      <div className="row-main">
        <div className="task-title-line">
          <h3>{task.title}</h3>
          <span className={done ? 'task-status done' : 'task-status pending'}>{statusText}</span>
        </div>
        <p>{task.description || '沒有任務說明'}</p>
        <small>
          {showAssignee && <>分派給 {assignee} · </>}
          截止 {task.deadline || '未設定'}
        </small>
      </div>

      <div className="row-action">
        <b>{task.reward} 金幣</b>
        {showCompleteAction && (
          done
            ? <span className="approved">已完成</span>
            : <button onClick={() => onComplete(task.id)}>完成</button>
        )}
      </div>
    </article>
  );
}
