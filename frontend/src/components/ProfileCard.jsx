import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { UiIcon } from '../lib/icons.js';

const TEXT = {
  groupFallback: '\u5171\u8b80\u7fa4\u7d44',
  groupName: '\u7fa4\u7d44\u540d\u7a31',
  editGroupName: '\u7de8\u8f2f\u7fa4\u7d44\u540d\u7a31',
  groupNamePlaceholder: '\u8f38\u5165\u7fa4\u7d44\u540d\u7a31',
  groupNameRequired: '\u7fa4\u7d44\u540d\u7a31\u4e0d\u53ef\u7a7a\u767d',
  groupNameUpdated: '\u7fa4\u7d44\u540d\u7a31\u5df2\u66f4\u65b0',
  groupNameUpdateFailed: '\u7fa4\u7d44\u540d\u7a31\u66f4\u65b0\u5931\u6557',
  save: '\u5132\u5b58',
  cancel: '\u53d6\u6d88',
  announcementRequired: '\u516c\u544a\u5167\u5bb9\u4e0d\u53ef\u7a7a\u767d',
  announcementPublished: '\u516c\u544a\u5df2\u767c\u5e03',
  announcementPublishFailed: '\u516c\u544a\u767c\u5e03\u5931\u6557',
  announcementDeleted: '\u516c\u544a\u5df2\u522a\u9664',
  announcementDeleteFailed: '\u516c\u544a\u522a\u9664\u5931\u6557',
  groupAnnouncement: '\u7fa4\u7d44\u516c\u544a',
  addAnnouncement: '\u65b0\u589e\u516c\u544a',
  announcementPlaceholder: '\u8f38\u5165\u516c\u544a\u5167\u5bb9',
  publish: '\u767c\u5e03',
  anonymousMember: '\u533f\u540d\u6210\u54e1',
  deleteAnnouncement: '\u522a\u9664\u516c\u544a',
  noAnnouncements: '\u76ee\u524d\u5c1a\u672a\u6709\u516c\u544a\uff0c\u9ede\u64ca\u53f3\u4e0a\u89d2\u7684\u7b46\u65b0\u589e\u4e00\u5247\u516c\u544a\u3002',
  studyNotebook: '\u7684\u8b80\u66f8\u7b46\u8a18',
  myCoins: '\u6211\u7684',
  coins: '\u91d1\u5e63',
  group: '\u7fa4\u7d44',
  logout: '\u767b\u51fa',
  groupTotalCoins: '\u7fa4\u7d44\u7e3d\u91d1\u5e63',
  memberCount: '\u6210\u54e1',
  peopleUnit: '\u4f4d',
  featuredTasks: '\u672c\u9031\u91cd\u9ede\u4efb\u52d9',
  unassigned: '\u672a\u6307\u6d3e',
  completed: '\u5df2\u5b8c\u6210',
  unset: '\u672a\u8a2d\u5b9a',
  due: '\u622a\u6b62',
  noFeaturedTasks: '\u76ee\u524d\u6c92\u6709\u91cd\u9ede\u4efb\u52d9\uff0c\u53ef\u4ee5\u5728\u4efb\u52d9\u5361\u7247\u4e0a\u8a2d\u70ba\u91cd\u9ede\u3002',
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
      setToast?.(data.message || TEXT.groupNameUpdated, 'success');
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
      setToast?.(data.message || TEXT.announcementPublished, 'success');
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
      setToast?.(data.message || TEXT.announcementDeleted, 'success');
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
          {!announcements.length && (
            <div className="empty-text empty-with-icon">
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
          {TEXT.myCoins} {userCoins} {TEXT.coins}{'\uFF0C'}{TEXT.group} {groupCoins} {TEXT.coins}
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
                      {task.assigned_to_nickname || task.assigned_name || TEXT.unassigned}{'\uFF5C'}
                      {done ? TEXT.completed : `${task.due_date || task.deadline || TEXT.unset} ${TEXT.due}`}{'\uFF5C'}
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
              <UiIcon name="heart" /> {member.nickname || member.name}{'\uFF1A'}{member.coins ?? member.coin ?? 0} {TEXT.coins}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
