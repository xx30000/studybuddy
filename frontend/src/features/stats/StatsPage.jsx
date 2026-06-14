import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getGroupCheckinWeekStats,
  getGroupContributionStats,
  getGroupStatsSummary,
  getGroupTaskTimeline,
  getTodayStudyTimeline,
  getUserCheckinWeekStats,
  getUserCoinStats,
  getUserStatsSummary,
  getUserStudyWeekStats,
} from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

const COLORS = ['#8fa3d2', '#f3b6c6', '#d8c48f', '#9fc8b3', '#c9a7d8', '#f2c18d'];

function shortDate(value) {
  if (!value) return '';
  const parts = String(value).slice(5, 10).split('-');
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : String(value);
}

function toDateValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function chartHasData(rows, key) {
  return Array.isArray(rows) && rows.some((row) => Number(row?.[key] || 0) > 0);
}

function taskStatusLabel(status) {
  if (status === 'completed') return '已完成';
  if (status === 'overdue') return '已逾期';
  return '進行中';
}

function buildGanttRows(tasks) {
  if (!tasks?.length) return [];
  const starts = tasks.map((task) => toDateValue(task.start_date)).filter(Boolean);
  const ends = tasks.map((task) => toDateValue(task.end_date)).filter(Boolean);
  const min = starts.length ? Math.min(...starts) : Date.now();
  const max = ends.length ? Math.max(...ends) : min + 86400000;
  const span = Math.max(86400000, max - min);

  return tasks.map((task) => {
    const start = toDateValue(task.start_date) || min;
    const end = toDateValue(task.end_date) || start + 86400000;
    const left = Math.max(0, ((start - min) / span) * 100);
    const width = Math.max(8, ((Math.max(end, start + 86400000) - start) / span) * 100);
    return { ...task, left, width: Math.min(width, 100 - left) };
  });
}

function minutesLabel(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours <= 0) return `${minutes} ??`;
  if (minutes <= 0) return `${hours} ??`;
  return `${hours} ?? ${minutes} ??`;
}

function timelineTimeLabel(minutes) {
  const safeMinutes = Math.max(0, Math.min(1440, Number(minutes || 0)));
  if (safeMinutes === 1440) return '24:00';
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildDisplayHours(sessions) {
  const earliest = sessions.reduce((min, session) => Math.min(min, Number(session.start_minutes || 1440)), 1440);
  const start = earliest < 540 ? 0 : 540;
  const hours = [];
  for (let minute = start; minute <= 1440; minute += 60) {
    hours.push(minute);
  }
  return { start, end: 1440, hours };
}

function SummaryGrid({ items }) {
  return (
    <section className="stats-grid summary-grid">
      {items.map((item) => (
        <div className="stats-summary-card" key={item.label}>
          <UiIcon name={item.icon} className="section-icon" />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.unit}</small>
        </div>
      ))}
    </section>
  );
}

function StudyWeekChart({ rows }) {
  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">近 7 天讀書時間</h3>
      {chartHasData(rows, 'minutes') ? (
        <div className="stats-chart-wrapper">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rows.map((item) => ({ ...item, label: shortDate(item.date) }))}>
              <CartesianGrid strokeDasharray="4 4" stroke="#ddd3c8" />
              <XAxis dataKey="label" />
              <YAxis unit="分" />
              <Tooltip />
              <Bar dataKey="minutes" fill="#8fa3d2" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="stats-empty">尚未有足夠資料，完成讀書計時或打卡後就會產生統計。</p>
      )}
    </div>
  );
}

function CoinTrendChart({ rows }) {
  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">金幣變化趨勢</h3>
      {rows.length > 0 ? (
        <div className="stats-chart-wrapper">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows.map((item, index) => ({ ...item, label: item.date ? shortDate(item.date) : `#${index + 1}` }))}>
              <CartesianGrid strokeDasharray="4 4" stroke="#ddd3c8" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="coins" stroke="#1f3f73" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="stats-empty">尚未有金幣變化資料。</p>
      )}
    </div>
  );
}

function CheckinWeek({ rows, title = '本週打卡紀錄' }) {
  return (
    <div className="stats-chart-card checkin-week-card">
      <h3 className="stats-chart-title">{title}</h3>
      {rows.length > 0 ? (
        <div className="checkin-week-row">
          {rows.map((day) => (
            <div className="checkin-week-day" key={day.date}>
              <span className={`checkin-week-dot ${day.checked ? 'done' : 'missed'}`}>{day.checked ? '✓' : ''}</span>
              <strong>{day.weekday || shortDate(day.date)}</strong>
              <small>{shortDate(day.date)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-empty">尚未有本週打卡資料。</p>
      )}
    </div>
  );
}

function GroupCheckinWeek({ rows }) {
  return (
    <div className="stats-chart-card checkin-week-card">
      <h3 className="stats-chart-title">群組本週打卡</h3>
      {rows.length > 0 ? (
        <div className="group-checkin-week-list">
          {rows.map((day) => (
            <div className="group-checkin-week-item" key={day.date}>
              <div>
                <strong>{day.weekday || shortDate(day.date)}</strong>
                <small>{shortDate(day.date)}</small>
              </div>
              <span>{day.checked_count || 0} / {day.member_count || 0} 人</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-empty">尚未有群組打卡資料。</p>
      )}
    </div>
  );
}

function TaskTimeline({ tasks, title }) {
  const ganttRows = useMemo(() => buildGanttRows(tasks), [tasks]);

  return (
    <section className="stats-chart-card">
      <h3 className="stats-chart-title">{title}</h3>
      {ganttRows.length > 0 ? (
        <div className="gantt-chart">
          <div className="gantt-axis">
            <span>起始</span>
            <span>截止</span>
          </div>
          {ganttRows.map((task) => (
            <div className="gantt-row" key={task.task_id || task.id}>
              <div className="gantt-label">
                <strong>{task.title}</strong>
                <small>{task.assignee_name || task.assigned_to_nickname || '未指派'}｜{shortDate(task.start_date)} - {shortDate(task.end_date)}</small>
              </div>
              <div className="gantt-timeline">
                <div
                  className={`gantt-bar ${task.status}`}
                  style={{ left: `${task.left}%`, width: `${task.width}%` }}
                  title={`${task.title} ${taskStatusLabel(task.status)}`}
                >
                  {taskStatusLabel(task.status)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-empty">尚未有任務時程資料。</p>
      )}
    </section>
  );
}

function DailyStudySchedule({ sessions }) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const { start, end, hours } = useMemo(() => buildDisplayHours(safeSessions), [safeSessions]);
  const totalMinutes = safeSessions.reduce((sum, session) => sum + Number(session.duration_minutes || 0), 0);
  const displayTotal = Math.max(60, end - start);

  return (
    <section className="stats-chart-card daily-schedule-card">
      <div className="daily-schedule-header">
        <div>
          <h3 className="daily-schedule-title">今日讀書時間線</h3>
          <p className="daily-schedule-description">依照今天的讀書監督紀錄，整理你實際讀書的時段。</p>
        </div>
        <strong className="daily-schedule-total">{minutesLabel(totalMinutes)}</strong>
      </div>

      {safeSessions.length > 0 ? (
        <>
          <div className="daily-schedule-body" style={{ minHeight: `${Math.max(420, hours.length * 48)}px` }}>
            <div className="daily-schedule-time-column">
              {hours.map((minute) => (
                <span
                  className="daily-schedule-time-label"
                  key={minute}
                  style={{ top: `${((minute - start) / displayTotal) * 100}%` }}
                >
                  {timelineTimeLabel(minute)}
                </span>
              ))}
            </div>
            <div className="daily-schedule-grid">
              {hours.map((minute) => (
                <span
                  className="daily-schedule-hour-line"
                  key={minute}
                  style={{ top: `${((minute - start) / displayTotal) * 100}%` }}
                />
              ))}
              {safeSessions.map((session) => {
                const clippedStart = Math.max(start, Number(session.start_minutes || start));
                const clippedEnd = Math.min(end, Math.max(clippedStart + 10, Number(session.end_minutes || clippedStart + Number(session.duration_minutes || 10))));
                const top = ((clippedStart - start) / displayTotal) * 100;
                const height = Math.max(6, ((clippedEnd - clippedStart) / displayTotal) * 100);
                return (
                  <div
                    className="daily-schedule-segment"
                    key={session.id}
                    style={{ top: `${top}%`, height: `${height}%` }}
                    title={`${session.start_time} - ${session.end_time}，${minutesLabel(session.duration_minutes)}`}
                  >
                    <span className="daily-schedule-segment-label">讀書 {minutesLabel(session.duration_minutes)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="daily-schedule-records">
            {safeSessions.map((session) => (
              <div className="daily-schedule-record" key={`record-${session.id}`}>
                <strong>{session.start_time} - {session.end_time}</strong>
                <span>{session.subject || '讀書'}｜{minutesLabel(session.duration_minutes)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="daily-schedule-empty">今天還沒有讀書監督紀錄。開始一段讀書計時後，這裡就會出現時間線。</p>
      )}
    </section>
  );
}

function PersonalStatsSection({ modeLabel, summary, studyWeek, coinPoints, checkinWeek, todayStudyTimeline, currentUser }) {
  const items = [
    { icon: 'hourglass', label: '今日讀書', value: summary?.today_study_minutes || 0, unit: '分鐘' },
    { icon: 'cat-book', label: '本週讀書', value: summary?.week_study_minutes || 0, unit: '分鐘' },
    { icon: 'check', label: '本週完成任務', value: summary?.week_completed_tasks || 0, unit: '件' },
    { icon: 'coin', label: '本週獲得金幣', value: summary?.week_earned_coins || 0, unit: '枚' },
    { icon: 'flag', label: '連續打卡', value: summary?.streak_days || 0, unit: '天' },
    { icon: 'money-bag', label: '目前金幣', value: summary?.coins ?? currentUser?.coins ?? 0, unit: '枚' },
  ];

  return (
    <section className="stats-section personal-stats-section">
      <div className="stats-section-heading">
        <div>
          <small className="stats-mode-pill"><UiIcon name="sprout" /> {modeLabel}</small>
          <h2 className="stats-section-title"><UiIcon name="cat-book" className="section-icon" /> 個人學習統計</h2>
          <p className="stats-section-description">這裡只計算你自己的讀書、打卡、任務與金幣變化。</p>
        </div>
      </div>

      <SummaryGrid items={items} />

      <section className="stats-grid chart-grid">
        <StudyWeekChart rows={studyWeek} />
        <CoinTrendChart rows={coinPoints} />
      </section>

      <section className="stats-grid chart-grid">
        <CheckinWeek rows={checkinWeek} />
        <DailyStudySchedule sessions={todayStudyTimeline} />
      </section>
    </section>
  );
}

function GroupProgressCard({ groupSummary }) {
  const completed = Number(groupSummary?.week_completed_tasks || 0);
  const total = Number(groupSummary?.week_total_tasks || 0);
  const completionRate = Number(groupSummary?.completion_rate || 0);
  const completionPie = [
    { name: '已完成', value: completed },
    { name: '未完成', value: Math.max(0, total - completed) },
  ];

  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">群組任務完成率</h3>
      <div className="stats-progress-bar" aria-label="群組任務完成率">
        <div className="stats-progress-fill" style={{ width: `${completionRate}%` }} />
      </div>
      <p className="stats-progress-label">{completed} / {total} 任務完成 ({completionRate}%)</p>
      {total > 0 ? (
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={completionPie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}>
              {completionPie.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p className="stats-empty">本週尚未有群組任務資料。</p>
      )}
    </div>
  );
}

function ContributionCard({ rows }) {
  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">成員貢獻比例</h3>
      {rows.some((item) => Number(item.contribution_score || 0) > 0) ? (
        <div className="stats-chart-wrapper">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rows} layout="vertical" margin={{ left: 16, right: 16 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#ddd3c8" />
              <XAxis type="number" />
              <YAxis dataKey="display_name" type="category" width={78} />
              <Tooltip />
              <Bar dataKey="contribution_score" fill="#f3b6c6" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="stats-empty">尚未有足夠貢獻資料。</p>
      )}
      <div className="contribution-list">
        {rows.map((item) => (
          <div className="contribution-item" key={item.user_id}>
            <strong>{item.display_name}</strong>
            <span>完成 {item.completed_tasks} 任務 / 讀書 {item.study_minutes} 分鐘 / 打卡 {item.checkin_days} 天</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupStatsSection({ currentGroup, groupSummary, contributions, timelineTasks, checkinWeek }) {
  const items = [
    { icon: 'friends', label: '群組成員', value: groupSummary?.member_count || 0, unit: '人' },
    { icon: 'hourglass', label: '群組本週讀書', value: groupSummary?.week_study_minutes || 0, unit: '分鐘' },
    { icon: 'check', label: '本週完成任務', value: groupSummary?.week_completed_tasks || 0, unit: '件' },
    { icon: 'coin', label: '本週獲得金幣', value: groupSummary?.week_earned_coins || 0, unit: '枚' },
    { icon: 'flag', label: '本週打卡人次', value: groupSummary?.week_checkin_days || 0, unit: '次' },
  ];

  return (
    <section className="stats-section group-stats-section">
      <div className="stats-section-heading">
        <div>
          <small className="stats-mode-pill"><UiIcon name="friends" /> {currentGroup?.name}</small>
          <h2 className="stats-section-title"><UiIcon name="task-list" className="section-icon" /> 群組統計</h2>
          <p className="stats-section-description">這裡整理整個共讀群組的任務、打卡、讀書時間與成員貢獻。</p>
        </div>
      </div>

      <SummaryGrid items={items} />

      <section className="stats-grid chart-grid">
        <GroupProgressCard groupSummary={groupSummary} />
        <ContributionCard rows={contributions} />
      </section>

      <section className="stats-grid chart-grid">
        <GroupCheckinWeek rows={checkinWeek} />
        <TaskTimeline tasks={timelineTasks} title="群組任務時程" />
      </section>
    </section>
  );
}

export default function StatsPage({ session, currentGroup = null, setToast, onOpenGroupSelector }) {
  const currentUser = session?.user;
  const groupId = currentGroup?.id || null;
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [hasLoadedStats, setHasLoadedStats] = useState(false);
  const [personalSummary, setPersonalSummary] = useState(null);
  const [personalStudyWeek, setPersonalStudyWeek] = useState([]);
  const [personalCoinPoints, setPersonalCoinPoints] = useState([]);
  const [personalCheckinWeek, setPersonalCheckinWeek] = useState([]);
  const [todayStudyTimeline, setTodayStudyTimeline] = useState([]);
  const [groupSummary, setGroupSummary] = useState(null);
  const [contributions, setContributions] = useState([]);
  const [groupTimelineTasks, setGroupTimelineTasks] = useState([]);
  const [groupCheckinWeek, setGroupCheckinWeek] = useState([]);

  async function loadStats() {
    if (!currentUser?.id) return;
    setIsStatsLoading(true);
    try {
      const [summaryData, studyData, coinData, checkinData, timelineData] = await Promise.all([
        getUserStatsSummary(currentUser.id, groupId),
        getUserStudyWeekStats(currentUser.id, groupId),
        getUserCoinStats(currentUser.id, groupId),
        getUserCheckinWeekStats(currentUser.id, groupId),
        getTodayStudyTimeline(currentUser.id, groupId),
      ]);

      setPersonalSummary(summaryData);
      setPersonalStudyWeek(studyData.days || summaryData.days || studyData || []);
      setPersonalCoinPoints(coinData.points || coinData || []);
      setPersonalCheckinWeek(checkinData.days || checkinData || []);
      setTodayStudyTimeline(timelineData.sessions || timelineData || []);

      if (groupId) {
        const [groupData, contributionData, groupTimelineData, groupCheckinData] = await Promise.all([
          getGroupStatsSummary(groupId),
          getGroupContributionStats(groupId),
          getGroupTaskTimeline(groupId),
          getGroupCheckinWeekStats(groupId),
        ]);
        setGroupSummary(groupData);
        setContributions(contributionData.contributions || contributionData || []);
        setGroupTimelineTasks(groupTimelineData.tasks || groupTimelineData || []);
        setGroupCheckinWeek(groupCheckinData.days || groupCheckinData || []);
      } else {
        setGroupSummary(null);
        setContributions([]);
        setGroupTimelineTasks([]);
        setGroupCheckinWeek([]);
      }
      setHasLoadedStats(true);
    } catch (err) {
      setToast?.(err.message || '統計資料載入失敗', 'error');
    } finally {
      setIsStatsLoading(false);
    }
  }

  useEffect(() => {
    setHasLoadedStats(false);
    loadStats();
  }, [currentUser?.id, groupId]);

  const modeLabel = groupId ? `${currentGroup?.name} 中的個人統計` : '個人讀書模式';

  return (
    <div className="stats-page home-card">
      <div className="stats-header">
        <div>
          <small className="icon-meta"><UiIcon name="sprout" /> {groupId ? currentGroup?.name : '個人讀書模式'}</small>
          <h1><UiIcon name="task-list" className="title-icon" /> 學習統計</h1>
          <p className="stats-subtitle">用讀書時間、打卡、任務與金幣看見這週的進度。</p>
        </div>
        {isStatsLoading && <span className="stats-loading">統計資料載入中...</span>}
      </div>

      {!hasLoadedStats && isStatsLoading ? (
        <section className="stats-chart-card stats-loading">統計資料載入中...</section>
      ) : (
        <>
          <PersonalStatsSection
            modeLabel={modeLabel}
            summary={personalSummary}
            studyWeek={personalStudyWeek}
            coinPoints={personalCoinPoints}
            checkinWeek={personalCheckinWeek}
            todayStudyTimeline={todayStudyTimeline}
            currentUser={currentUser}
          />

          {groupId ? (
            <GroupStatsSection
              currentGroup={currentGroup}
              groupSummary={groupSummary}
              contributions={contributions}
              timelineTasks={groupTimelineTasks}
              checkinWeek={groupCheckinWeek}
            />
          ) : (
            <section className="stats-chart-card stats-empty-card">
              <h2 className="stats-chart-title">群組統計</h2>
              <p className="stats-empty">此統計需要先選擇共讀群組。可以使用右上角選單切換群組，或到設定中的共讀群組管理建立 / 加入群組。</p>
              <button type="button" className="stats-manage-button" onClick={onOpenGroupSelector}>
                <UiIcon name="gear" /> 前往共讀群組管理
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
