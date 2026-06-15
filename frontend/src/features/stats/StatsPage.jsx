import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localMonthDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function getCurrentWeekRange(baseDate = new Date()) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);

  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

function getWeekDays(monday) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

function localWeekdayLabel(date) {
  return ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()];
}

function buildCurrentWeekCheckinRows(rows, type = 'personal') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { monday } = getCurrentWeekRange();
  const days = getWeekDays(monday);
  const rowsByDate = new Map(safeRows.map((row) => [String(row?.date || '').slice(0, 10), row]));

  return days.map((date) => {
    const dateKey = localDateKey(date);
    const source = rowsByDate.get(dateKey) || {};
    const checkedCount = Number(source.checked_count || 0);
    const memberCount = Number(source.member_count || 0);
    return {
      ...source,
      date: dateKey,
      label: localMonthDay(date),
      day: localWeekdayLabel(date),
      weekday: localWeekdayLabel(date),
      checked: type === 'group' ? checkedCount > 0 : Boolean(source.checked),
      checked_count: checkedCount,
      member_count: memberCount,
    };
  });
}

function toDateValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
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
  if (hours <= 0) return `${minutes} 分鐘`;
  if (minutes <= 0) return `${hours} 小時`;
  return `${hours} 小時 ${minutes} 分鐘`;
}
function timelineTimeLabel(minutes) {
  const safeMinutes = Math.max(0, Math.min(1440, Number(minutes || 0)));
  if (safeMinutes === 1440) return '24:00';
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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
  const chartRows = Array.isArray(rows)
    ? rows.map((item) => ({
      ...item,
      label: shortDate(item.date),
      totalMinutes: Number(item.totalMinutes ?? item.minutes ?? 0),
    }))
    : [];

  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">近 7 天讀書時間</h3>
      {chartRows.length > 0 ? (
        <div className="stats-chart-wrapper">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartRows} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#ddd3c8" />
              <XAxis dataKey="label" />
              <YAxis unit="分" allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} 分鐘`, '讀書時間']} labelFormatter={(label) => `日期：${label}`} />
              <Line
                type="monotone"
                dataKey="totalMinutes"
                stroke="var(--theme-primary-dark, #1f3f73)"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="stats-empty">統計資料載入完成後，這裡會顯示最近 7 天每日讀書總時長。</p>
      )}
    </div>
  );
}

function CoinTrendChart({ rows }) {
  const chartRows = useMemo(() => {
    const dailyMap = new Map();
    const safeRows = Array.isArray(rows) ? rows : [];
    safeRows.forEach((item, index) => {
      const dateKey = String(item?.date || item?.label || `#${index + 1}`).slice(0, 10);
      const label = item?.label || (item?.date ? shortDate(item.date) : `#${index + 1}`);
      dailyMap.set(dateKey, {
        ...item,
        date: dateKey,
        label,
        totalCoins: Number(item?.totalCoins ?? item?.total_coins ?? item?.coins ?? 0),
      });
    });
    return Array.from(dailyMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [rows]);

  return (
    <div className="stats-chart-card">
      <h3 className="stats-chart-title">金幣變化趨勢</h3>
      {chartRows.length > 0 ? (
        <div className="stats-chart-wrapper">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="4 4" stroke="#ddd3c8" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} 枚`, '總金幣']} labelFormatter={(label) => `日期：${label}`} />
              <Line
                type="monotone"
                dataKey="totalCoins"
                stroke="var(--theme-primary-dark, #1f3f73)"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="stats-empty">尚未有金幣變化資料。</p>
      )}
    </div>
  );
}

function checkinWeekRangeLabel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return `${shortDate(rows[0].date)} - ${shortDate(rows[rows.length - 1].date)}`;
}

function CheckinWeek({ rows, title = '本週打卡紀錄' }) {
  const displayRows = useMemo(() => buildCurrentWeekCheckinRows(rows, 'personal'), [rows]);
  const weekRangeLabel = checkinWeekRangeLabel(displayRows);

  return (
    <div className="stats-chart-card checkin-week-card">
      <div className="checkin-week-heading">
        <h3 className="stats-chart-title">{title}</h3>
        {weekRangeLabel && <small className="checkin-week-range">{weekRangeLabel}</small>}
      </div>
      {displayRows.length > 0 ? (
        <div className="checkin-week-row">
          {displayRows.map((day) => (
            <div className="checkin-week-day" key={day.date}>
              <span className={`checkin-week-dot ${day.checked ? 'done' : 'missed'}`}>{day.checked ? '✓' : ''}</span>
              <strong>{day.weekday || day.day || shortDate(day.date)}</strong>
              <small>{day.label || shortDate(day.date)}</small>
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
  const displayRows = useMemo(() => buildCurrentWeekCheckinRows(rows, 'group'), [rows]);
  const weekRangeLabel = checkinWeekRangeLabel(displayRows);

  return (
    <div className="stats-chart-card checkin-week-card">
      <div className="checkin-week-heading">
        <h3 className="stats-chart-title">群組本週打卡</h3>
        {weekRangeLabel && <small className="checkin-week-range">{weekRangeLabel}</small>}
      </div>
      {displayRows.length > 0 ? (
        <div className="group-checkin-week-list">
          {displayRows.map((day) => (
            <div className="group-checkin-week-item" key={day.date}>
              <div>
                <strong>{day.weekday || day.day || shortDate(day.date)}</strong>
                <small>{day.label || shortDate(day.date)}</small>
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
  const timelineScrollRef = useRef(null);
  const dragStateRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
  const totalMinutes = safeSessions.reduce((sum, session) => sum + Number(session.duration_minutes || 0), 0);
  const hourWidth = 90;
  const dayTotalMinutes = 24 * 60;
  const timelineWidth = 24 * hourWidth;
  const minBlockWidth = 80;
  const hours = useMemo(() => Array.from({ length: 25 }, (_, hour) => hour * 60), []);

  function clampMinute(value, fallback = 0) {
    const minute = Number(value);
    if (!Number.isFinite(minute)) return fallback;
    return Math.max(0, Math.min(dayTotalMinutes, minute));
  }

  function handleTimelinePointerDown(event) {
    if (event.pointerType !== 'mouse' || !timelineScrollRef.current) return;
    dragStateRef.current = {
      isDragging: true,
      startX: event.clientX,
      scrollLeft: timelineScrollRef.current.scrollLeft,
    };
    timelineScrollRef.current.classList.add('dragging');
    timelineScrollRef.current.setPointerCapture?.(event.pointerId);
  }

  function handleTimelinePointerMove(event) {
    const dragState = dragStateRef.current;
    if (!dragState.isDragging || !timelineScrollRef.current) return;
    event.preventDefault();
    const walk = event.clientX - dragState.startX;
    timelineScrollRef.current.scrollLeft = dragState.scrollLeft - walk;
  }

  function stopTimelineDrag(event) {
    if (!dragStateRef.current.isDragging) return;
    dragStateRef.current.isDragging = false;
    timelineScrollRef.current?.classList.remove('dragging');
    if (event?.pointerId !== undefined) {
      timelineScrollRef.current?.releasePointerCapture?.(event.pointerId);
    }
  }

  return (
    <section className="stats-chart-card daily-schedule-card today-timeline-card">
      <div className="daily-schedule-header">
        <div>
          <h3 className="daily-schedule-title">今日讀書時間線</h3>
          <p className="daily-schedule-description">依照今天的讀書監督紀錄，整理你實際讀書的時段。</p>
        </div>
        <strong className="daily-schedule-total">{minutesLabel(totalMinutes)}</strong>
      </div>

      {safeSessions.length > 0 ? (
        <>
          <div
            className="horizontal-timeline-scroll"
            ref={timelineScrollRef}
            role="region"
            aria-label="今日橫向讀書時間線"
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={stopTimelineDrag}
            onPointerCancel={stopTimelineDrag}
            onPointerLeave={stopTimelineDrag}
          >
            <div className="horizontal-timeline-inner" style={{ width: `${timelineWidth}px` }}>
              <div className="horizontal-time-axis" aria-hidden="true">
                {hours.map((minute) => (
                  <span
                    className="horizontal-time-label"
                    key={minute}
                    style={{ left: `${(minute / dayTotalMinutes) * timelineWidth}px` }}
                  >
                    {timelineTimeLabel(minute)}
                  </span>
                ))}
              </div>

              <div className="horizontal-timeline-track">
                {hours.map((minute) => (
                  <span
                    className="horizontal-hour-line"
                    key={minute}
                    style={{ left: `${(minute / dayTotalMinutes) * timelineWidth}px` }}
                  />
                ))}

                {safeSessions.map((session) => {
                  const rawStart = clampMinute(session.start_minutes, 0);
                  const fallbackEnd = rawStart + Number(session.duration_minutes || 0);
                  const rawEnd = clampMinute(session.end_minutes, fallbackEnd);
                  const endMinute = Math.max(rawStart + 1, rawEnd);
                  const duration = Math.max(1, Number(session.duration_minutes || endMinute - rawStart));
                  const calculatedLeft = (rawStart / dayTotalMinutes) * timelineWidth;
                  const calculatedWidth = ((Math.min(dayTotalMinutes, endMinute) - rawStart) / dayTotalMinutes) * timelineWidth;
                  const blockLeft = Math.min(calculatedLeft, timelineWidth - minBlockWidth);
                  const blockWidth = Math.min(
                    Math.max(calculatedWidth, minBlockWidth),
                    timelineWidth - blockLeft,
                  );
                  const subject = session.subject || '讀書';
                  const label = subject && subject !== '讀書'
                    ? `${subject}｜${minutesLabel(duration)}`
                    : `讀書 ${minutesLabel(duration)}`;

                  return (
                    <div
                      className="horizontal-study-block"
                      key={session.id}
                      style={{ left: `${blockLeft}px`, width: `${blockWidth}px` }}
                      title={`${session.start_time} - ${session.end_time}，${label}`}
                    >
                      <span className="horizontal-study-block-label">{label}</span>
                    </div>
                  );
                })}
              </div>
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
