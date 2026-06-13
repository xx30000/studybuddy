import React from 'react';
import { CheckCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { notificationIconMap, UiIcon } from '../../lib/icons.js';

const TYPE_LABELS = {
  task: '任務',
  coin: '金幣',
  card: '卡牌',
  draw: '抽卡',
  approval: '審核',
  announcement: '公告',
  system: '系統',
};

export default function NotificationsPage({ session, notifications, refreshNotifications, setToast }) {
  async function markRead(notification) {
    if (Number(notification.is_read) === 1) return;
    await api(`/notifications/${notification.id}/read`, { method: 'PUT' });
    refreshNotifications();
  }

  async function markAllRead() {
    await api(`/groups/${session.group.id}/notifications/read-all`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: session.user.id }),
    });
    setToast('全部通知已標記為已讀', 'success');
    refreshNotifications();
  }

  const unreadCount = notifications.filter((item) => Number(item.is_read) === 0).length;

  return (
    <div className="page-stack">
      <section className="white-card notification-head notification-section home-card">
        <div>
          <div className="section-title blue notification-page-title"><span /><UiIcon name="bell" className="title-icon" />通知中心</div>
          <p>所有任務、金幣、卡牌與系統提醒都會收在這裡。</p>
        </div>
        <button className="primary-btn compact inline-action" onClick={markAllRead} disabled={!unreadCount}>
          <CheckCheck size={17} /> 全部標記已讀
        </button>
      </section>

      <section className="white-card notification-section home-card">
        <div className="notification-list">
          {notifications.map((notification) => {
            const unread = Number(notification.is_read) === 0;
            return (
              <article
                className={`notification-card ${unread ? 'unread' : 'read'}`}
                key={notification.id}
                onClick={() => markRead(notification)}
              >
                <UiIcon
                  src={notificationIconMap[notification.type] || notificationIconMap.system}
                  className="notification-icon"
                />
                <div className="notification-card-main">
                  <div className="notification-title-line">
                    <h3 className="notification-card-title">{notification.title}</h3>
                    <span className={`notification-type type-${notification.type}`}>
                      {TYPE_LABELS[notification.type] || notification.type || TYPE_LABELS.system}
                    </span>
                  </div>
                  <p className="notification-card-message">{notification.message}</p>
                  <small className="notification-card-time">{notification.created_at}</small>
                </div>
                <span className="read-state">{unread ? '未讀' : '已讀'}</span>
              </article>
            );
          })}
          {!notifications.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="bell" className="empty-icon" />
              <p>目前還沒有通知</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
