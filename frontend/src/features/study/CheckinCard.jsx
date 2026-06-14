import React, { useEffect, useMemo, useState } from 'react';
import { createOrUpdateCheckin, getGroupTodayCheckins, getTodayCheckin } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

const MOOD_OPTIONS = ['很有精神', '普通', '有點累', '低電量', '壓力大', '完成很多'];

function formatDateTime(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

export default function CheckinCard({
  session,
  currentGroup = null,
  setToast,
  onUserCoinsUpdated,
  refresh,
}) {
  const currentUser = session?.user;
  const groupId = currentGroup?.id || null;
  const [todayCheckin, setTodayCheckin] = useState(null);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [checkinStreakDays, setCheckinStreakDays] = useState(0);
  const [groupCheckins, setGroupCheckins] = useState([]);
  const [isCheckinLoading, setIsCheckinLoading] = useState(false);
  const [hasLoadedCheckin, setHasLoadedCheckin] = useState(false);
  const [checkinMood, setCheckinMood] = useState('');
  const [checkinNote, setCheckinNote] = useState('');
  const [checkinStudyMinutes, setCheckinStudyMinutes] = useState('');

  const modeLabel = groupId ? '群組打卡' : '個人打卡';
  const statusText = hasCheckedInToday ? '今日已打卡' : '今日尚未打卡';
  const submitLabel = hasCheckedInToday ? '更新今日打卡' : '完成今日打卡';

  const groupDoneCount = useMemo(
    () => groupCheckins.filter((item) => item.has_checked_in_today).length,
    [groupCheckins],
  );

  async function loadCheckinData() {
    if (!currentUser?.id) return;
    setIsCheckinLoading(true);
    try {
      const today = await getTodayCheckin(currentUser.id, groupId);
      const checkin = today.checkin || null;
      setTodayCheckin(checkin);
      setHasCheckedInToday(Boolean(today.has_checked_in_today));
      setCheckinStreakDays(today.streak_days || 0);
      setCheckinMood(checkin?.mood || '');
      setCheckinNote(checkin?.note || '');
      setCheckinStudyMinutes(checkin?.study_minutes ? String(checkin.study_minutes) : '');

      if (groupId) {
        const groupToday = await getGroupTodayCheckins(groupId);
        setGroupCheckins(groupToday.checkins || groupToday || []);
      } else {
        setGroupCheckins([]);
      }
      setHasLoadedCheckin(true);
    } catch (err) {
      setToast?.(err.message || '打卡資料載入失敗', 'error');
    } finally {
      setIsCheckinLoading(false);
    }
  }

  useEffect(() => {
    setHasLoadedCheckin(false);
    loadCheckinData();
  }, [currentUser?.id, groupId]);

  async function submitCheckin() {
    if (!currentUser?.id) return;
    const minutes = Number.parseInt(checkinStudyMinutes, 10);
    try {
      const data = await createOrUpdateCheckin({
        user_id: currentUser.id,
        group_id: groupId,
        mood: checkinMood,
        note: checkinNote,
        study_minutes: Number.isFinite(minutes) ? Math.max(0, minutes) : 0,
      });
      setToast?.(data.message || '今日打卡完成', 'success');
      if (data.user_coins !== undefined && data.user_coins !== null) {
        onUserCoinsUpdated?.(data.user_coins);
      }
      await loadCheckinData();
      refresh?.();
    } catch (err) {
      setToast?.(err.message || '打卡失敗', 'error');
    }
  }

  return (
    <section className="checkin-card home-card">
      <div className="checkin-header">
        <div>
          <small className="icon-meta"><UiIcon name="check" /> {modeLabel}</small>
          <h2 className="checkin-title">
            <UiIcon name="flag" className="section-icon" />
            每日讀書打卡
          </h2>
        </div>
        <div className={`checkin-status-badge ${hasCheckedInToday ? 'done' : 'pending'}`}>
          {statusText}
        </div>
      </div>

      {isCheckinLoading && !hasLoadedCheckin ? (
        <p className="checkin-summary">打卡狀態載入中...</p>
      ) : (
        <>
          <div className="checkin-summary">
            <span>連續打卡</span>
            <strong>{checkinStreakDays}</strong>
            <span>天</span>
          </div>

          {todayCheckin && (
            <div className="checkin-streak">
              <UiIcon name="star" /> 今天記錄：{todayCheckin.mood || '未選心情'}，讀書 {todayCheckin.study_minutes || 0} 分鐘
            </div>
          )}

          <div className="checkin-mood-grid" role="list" aria-label="選擇今日狀態">
            {MOOD_OPTIONS.map((mood) => (
              <button
                key={mood}
                type="button"
                className={`checkin-mood-option ${checkinMood === mood ? 'active' : ''}`}
                onClick={() => setCheckinMood(mood)}
              >
                {mood}
              </button>
            ))}
          </div>

          <label className="checkin-field-label" htmlFor="checkin-note">今日完成事項</label>
          <textarea
            id="checkin-note"
            className="checkin-note-input"
            value={checkinNote}
            onChange={(event) => setCheckinNote(event.target.value)}
            placeholder="例如：讀完網路程式第三章、完成 UML 部署圖"
          />

          <label className="checkin-field-label" htmlFor="checkin-minutes">讀書分鐘數</label>
          <input
            id="checkin-minutes"
            className="checkin-minutes-input"
            type="number"
            min="0"
            value={checkinStudyMinutes}
            onChange={(event) => setCheckinStudyMinutes(event.target.value)}
            placeholder="例如：120"
          />

          <button
            type="button"
            className="checkin-submit-button"
            onClick={submitCheckin}
            disabled={isCheckinLoading}
          >
            <UiIcon name="coin" /> {submitLabel}
          </button>
        </>
      )}

      {groupId && (
        <div className="group-checkin-card">
          <div className="group-checkin-head">
            <b><UiIcon name="friends" /> 今日群組打卡</b>
            <span>{groupDoneCount} / {groupCheckins.length} 已打卡</span>
          </div>
          {!hasLoadedCheckin || isCheckinLoading ? (
            <p className="checkin-summary">打卡狀態載入中...</p>
          ) : groupCheckins.length > 0 ? (
            <div className="group-checkin-list">
              {groupCheckins.map((item) => (
                <div className="group-checkin-item" key={item.user_id}>
                  <div className="group-checkin-member">
                    <strong>{item.display_name}</strong>
                    <span className={`group-checkin-status ${item.has_checked_in_today ? 'done' : 'pending'}`}>
                      {item.has_checked_in_today ? '已打卡' : '尚未打卡'}
                    </span>
                  </div>
                  {item.has_checked_in_today ? (
                    <p>
                      {item.mood || '未選心情'}｜讀書 {item.study_minutes || 0} 分鐘
                      {item.note ? `｜${item.note}` : ''}
                    </p>
                  ) : (
                    <p>還沒留下今日讀書打卡。</p>
                  )}
                  {item.checkin_time && <small>{formatDateTime(item.checkin_time)}</small>}
                </div>
              ))}
            </div>
          ) : (
            <p className="checkin-summary">尚未有成員打卡資料</p>
          )}
        </div>
      )}
    </section>
  );
}
