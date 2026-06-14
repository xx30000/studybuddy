import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { UiIcon } from '../lib/icons.js';

const TEXT = {
  groupFallback: '共讀群組',
  groupName: '群組名稱',
  editGroupName: '編輯群組名稱',
  groupNamePlaceholder: '輸入群組名稱',
  groupNameRequired: '群組名稱不可空白',
  groupNameUpdated: '群組名稱已更新',
  groupNameUpdateFailed: '群組名稱更新失敗',
  save: '儲存',
  cancel: '取消',
  announcementRequired: '公告內容不可空白',
  announcementPublished: '公告已發布',
  announcementPublishFailed: '公告發布失敗',
  announcementDeleted: '公告已刪除',
  announcementDeleteFailed: '公告刪除失敗',
  groupAnnouncement: '群組公告',
  addAnnouncement: '新增公告',
  announcementPlaceholder: '輸入公告內容',
  publish: '發布',
  anonymousMember: '匿名成員',
  deleteAnnouncement: '刪除公告',
  noAnnouncements: '目前尚未有公告，點擊右上角的筆新增一則公告。',
  studyNotebook: '的讀書筆記',
  myCoins: '我的',
  coins: '金幣',
  group: '群組',
  logout: '登出',
  groupTotalCoins: '群組總金幣',
  memberCount: '成員',
  peopleUnit: '位',
  featuredTasks: '本週重點任務',
  unassigned: '未指派',
  completed: '已完成',
  unset: '未設定',
  due: '截止',
  noFeaturedTasks: '目前沒有重點任務，可以在任務卡片上設為重點。',
};

function getGroup(session, groupInfo) {
  return groupInfo?.group || session.group || {};
}

function getMembers(session, groupInfo) {
  const group = getGroup(session, groupInfo);
  return groupInfo?.members || group.members || [];
}

export function GroupNameHeader({ session, groupInfo, refresh, onGroupUpdated, setToast }) {
  const group = getGroup(session, groupInfo);
  const groupName = group.name || TEXT.groupFallback;
  const [isEditingGroupName, setIsEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');

  function startEditGroupName() {
    setGroupNameDraft(groupName);
    setIsEditingGroupName(true);
  }

  function cancelEditGroupName() {
    setGroupNameDraft('');
    setIsEditingGroupName(false);
  }

  async function saveGroupName() {
    const nextName = groupNameDraft.trim();
    if (!nextName) {
      setToast?.(TEXT.groupNameRequired, 'error');
      return;
    }

    try {
      const data = await api(`/groups/${group.id}/name`, {
        method: 'PUT',
        body: JSON.stringify({
          user_id: session.user.id,
          name: nextName,
        }),
      });
      setToast?.(data.message || TEXT.groupNameUpdated, 'success', `group-name-updated:${session.user.id}:${group.id}:${Date.now()}`);
      setIsEditingGroupName(false);
      setGroupNameDraft('');
      onGroupUpdated?.(data.group);
      refresh?.();
    } catch (err) {
      setToast?.(err.message || TEXT.groupNameUpdateFailed, 'error');
    }
  }

  return (
    <section className="group-name-heading-card group-name-card group-name-section home-card">
      <div className="group-name-heading-row">
        <UiIcon name="flag" className="group-name-heading-icon" />
        <small className="group-name-kicker">{TEXT.groupName}</small>
        {!isEditingGroupName && (
          <button
            className="icon-action group-name-edit-icon"
            type="button"
            aria-label={TEXT.editGroupName}
            title={TEXT.editGroupName}
            onClick={startEditGroupName}
          >
            <UiIcon name="pencil" />
          </button>
        )}
      </div>

      {isEditingGroupName ? (
        <div className="group-name-editor group-name-heading-editor">
          <input
            className="group-name-input group-name-heading-input"
            value={groupNameDraft}
            onChange={(event) => setGroupNameDraft(event.target.value)}
            placeholder={TEXT.groupNamePlaceholder}
          />
          <div className="group-name-edit-actions">
            <button className="group-name-mini-btn group-name-save-btn" type="button" onClick={saveGroupName}>
              {TEXT.save}
            </button>
            <button className="group-name-mini-btn group-name-cancel-btn" type="button" onClick={cancelEditGroupName}>
              {TEXT.cancel}
            </button>
          </div>
        </div>
      ) : (
        <h1 className="group-name-heading">{groupName}</h1>
      )}
    </section>
  );
}

export function GroupAnnouncementPanel({
  session,
  groupInfo,
  announcements = [],
  refreshAnnouncements,
  refresh,
  setToast,
  isLoading = false,
  hasLoaded = false,
}) {
  const group = getGroup(session, groupInfo);
  const members = getMembers(session, groupInfo);
  const canManageAnnouncements = members.some((member) => String(member.id) === String(session.user.id));
  const [isAnnouncementEditorOpen, setIsAnnouncementEditorOpen] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState('');

  async function publishAnnouncement() {
    if (!announcementDraft.trim()) {
      setToast?.(TEXT.announcementRequired, 'error');
      return;
    }

    try {
      const data = await api(`/groups/${group.id}/announcements`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: session.user.id,
          content: announcementDraft,
        }),
      });
      setToast?.(data.message || TEXT.announcementPublished, 'success', `announcement-published:${session.user.id}:${data.announcement?.id || Date.now()}`);
      setAnnouncementDraft('');
      setIsAnnouncementEditorOpen(false);
      await refreshAnnouncements?.();
      refresh?.();
    } catch (err) {
      setToast?.(err.message || TEXT.announcementPublishFailed, 'error');
    }
  }

  async function deleteAnnouncement(announcementId) {
    try {
      const data = await api(`/groups/${group.id}/announcements/${announcementId}`, {
        method: 'DELETE',
        body: JSON.stringify({ user_id: session.user.id }),
      });
      setToast?.(data.message || TEXT.announcementDeleted, 'success', `announcement-deleted:${session.user.id}:${announcementId}`);
      await refreshAnnouncements?.();
      refresh?.();
    } catch (err) {
      setToast?.(err.message || TEXT.announcementDeleteFailed, 'error');
    }
  }

  return (
    <section className="announcement-section group-announcement-section home-card">
      <div className="announcement-box announcement-panel">
        <div className="announcement-head">
          <b className="section-title-row"><UiIcon name="announcement" className="section-icon" /> {TEXT.groupAnnouncement}</b>
          {canManageAnnouncements && (
            <button
              className="icon-action announcement-edit-icon"
              type="button"
              aria-label={TEXT.addAnnouncement}
              title={TEXT.addAnnouncement}
              onClick={() => setIsAnnouncementEditorOpen((open) => !open)}
            >
              <UiIcon name="pencil" />
            </button>
          )}
        </div>

        {isAnnouncementEditorOpen && (
          <div className="announcement-edit">
            <textarea
              value={announcementDraft}
              onChange={(event) => setAnnouncementDraft(event.target.value)}
              placeholder={TEXT.announcementPlaceholder}
            />
            <div className="announcement-mini-actions">
              <button className="announcement-mini-btn announcement-submit-btn" type="button" onClick={publishAnnouncement}>
                {TEXT.publish}
              </button>
              <button
                className="announcement-mini-btn announcement-cancel-btn"
                type="button"
                onClick={() => {
                  setAnnouncementDraft('');
                  setIsAnnouncementEditorOpen(false);
                }}
              >
                {TEXT.cancel}
              </button>
            </div>
          </div>
        )}

        <div className="announcement-list">
          {isLoading && announcements.length === 0 && (
            <div className="loading-hint">{TEXT.announcementsLoading}</div>
          )}
          {announcements.map((announcement, index) => (
            <article className="announcement-note announcement-card" key={announcement.id}>
              <span className="announcement-index">{index + 1}.</span>
              <div className="announcement-note-main">
                <div className="announcement-card-header">
                  <p className="announcement-content-main">{announcement.content}</p>
                  <div className="announcement-card-actions">
                    <span className="announcement-author">{announcement.nickname || TEXT.anonymousMember}</span>
                    {canManageAnnouncements && (
                      <button
                        className="icon-action announcement-delete-icon"
                        type="button"
                        aria-label={TEXT.deleteAnnouncement}
                        title={TEXT.deleteAnnouncement}
                        onClick={() => deleteAnnouncement(announcement.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="announcement-time">{announcement.created_at}</p>
              </div>
            </article>
          ))}
          {!isLoading && hasLoaded && !announcements.length && (
            <div className="empty-text empty-with-icon empty-hint">
              <UiIcon name="message" className="empty-icon" />
              <p>{TEXT.noAnnouncements}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function ProfileCard({
  session,
  groupInfo,
}) {
  const group = getGroup(session, groupInfo);
  const members = getMembers(session, groupInfo);
  const currentMember = members.find((member) => String(member.id) === String(session.user.id));
  const userCoins = currentMember?.coins ?? currentMember?.coin ?? session.user.coins ?? session.user.coin ?? 0;
  const groupCoins = group.total_coins ?? group.total_coin ?? 0;
  const nickname = currentMember?.nickname || currentMember?.name || session.user.nickname || session.user.name;
  const featuredTasks = group.featured_tasks || [];

  return (
    <section className="profile-royal-card user-note-card home-card">
      <div className="crown-icon"><UiIcon name="sprout" className="hero-icon" /></div>
      <div className="profile-text">
        <h2 className="hero-title-row"><UiIcon name="star" className="title-icon" />{nickname} {TEXT.studyNotebook}</h2>
        <p>
          <UiIcon name="coin" />
          {TEXT.myCoins} {userCoins} {TEXT.coins}{'，'}{TEXT.group} {groupCoins} {TEXT.coins}
        </p>
      </div>
      <div className="group-summary-card profile-summary-only">
        <div className="group-stats">
          <span><UiIcon name="coin" /> {TEXT.groupTotalCoins} {groupCoins}</span>
          <span><UiIcon name="heart" /> {TEXT.memberCount} {members.length} {TEXT.peopleUnit}</span>
        </div>
        <div className="featured-task-box">
          <b className="section-title-row"><UiIcon name="star" className="section-icon" /> {TEXT.featuredTasks}</b>
          <div className="featured-task-list">
            {featuredTasks.map((task) => {
              const done = Number(task.is_completed) === 1;
              return (
                <div className={`featured-task-item ${done ? 'done' : ''}`} key={task.id}>
                  <span className="mini-check">{done ? <UiIcon name="check" /> : ''}</span>
                  <p>
                    <strong>{task.title}</strong>
                    <small>
                      {task.assigned_to_nickname || task.assigned_name || TEXT.unassigned}{'｜'}
                      {done ? TEXT.completed : `${task.due_date || task.deadline || TEXT.unset} ${TEXT.due}`}{'｜'}
                      {task.coin_reward ?? task.reward ?? 0} {TEXT.coins}
                    </small>
                  </p>
                </div>
              );
            })}
            {!featuredTasks.length && (
              <div className="empty-text empty-with-icon">
                <UiIcon name="star" className="empty-icon" />
                <p>{TEXT.noFeaturedTasks}</p>
              </div>
            )}
          </div>
        </div>
        <div className="group-member-coins">
          {members.map((member) => (
            <span key={member.id}>
              <UiIcon name="heart" /> {member.nickname || member.name}{'：'}{member.coins ?? member.coin ?? 0} {TEXT.coins}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
