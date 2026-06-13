import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

const CATEGORIES = ['休息獎勵', '學習加成', '生活小獎', '團隊互動', '特別權利'];
const RARITIES = ['普通', '稀有', '史詩', '傳說'];
const DEFAULT_WEIGHTS = {
  '普通': 60,
  '稀有': 25,
  '史詩': 10,
  '傳說': 5,
};
const DRAW_COST = 50;

function iconSrc(iconKey) {
  return `/images/icons-transparent/${iconKey || 'star.png'}`;
}

function totalActiveWeight(cards) {
  return cards
    .filter((card) => card.status === 'active' && Number(card.is_active) === 1)
    .reduce((sum, card) => sum + Number(card.weight || 0), 0);
}

function drawRate(card, totalWeight) {
  if (!totalWeight || card.status !== 'active' || Number(card.is_active) !== 1) return '0%';
  return `${((Number(card.weight || 0) / totalWeight) * 100).toFixed(1)}%`;
}

export default function Treasure({ session, rewardCards, refresh, setToast }) {
  const [showForm, setShowForm] = useState(false);
  const [drawResult, setDrawResult] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '休息獎勵',
    rarity: '普通',
  });

  const activeCards = useMemo(
    () => rewardCards.filter((card) => card.status === 'active' && Number(card.is_active) === 1),
    [rewardCards],
  );
  const pendingCards = useMemo(
    () => rewardCards.filter((card) => card.status === 'pending'),
    [rewardCards],
  );
  const activeTotalWeight = useMemo(() => totalActiveWeight(rewardCards), [rewardCards]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, rarity: prev.rarity || '普通' }));
  }, []);

  async function createCard(e) {
    e.preventDefault();
    if (!form.title.trim()) return setToast('請輸入卡牌名稱', 'error');

    await api(`/groups/${session.group.id}/reward-cards`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        created_by: session.user.id,
      }),
    });
    setToast('卡牌申請已送出', 'success');
    setForm({ title: '', description: '', category: '休息獎勵', rarity: '普通' });
    setShowForm(false);
    refresh();
  }

  async function approveCard(card) {
    const data = await api(`/reward-cards/${card.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ user_id: session.user.id }),
    });
    setToast(data.message, 'success');
    refresh();
  }

  async function drawCard() {
    try {
      const data = await api(`/groups/${session.group.id}/draw-card`, {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id }),
      });
      setDrawResult(data);
      setToast(`抽卡成功，抽中「${data.reward_card.title}」`, 'success');
      refresh();
    } catch (err) {
      setToast(err.message, 'error');
    }
  }

  function approvalAction(card) {
    if (card.status === 'active' || Number(card.is_active) === 1) {
      return <span className="approval-note passed"><UiIcon name="check" /> 已加入國庫</span>;
    }
    if (Number(card.created_by) === Number(session.user.id)) {
      return <span className="approval-note"><UiIcon name="pencil" /> 你已提出此卡牌</span>;
    }
    if (card.current_user_approved) {
      return <span className="approval-note"><UiIcon name="heart" /> 你已同意</span>;
    }
    return <button className="task-action-button treasury-action-button" type="button" onClick={() => approveCard(card)}>同意加入卡牌池</button>;
  }

  return (
    <div className="page-stack">
      {drawResult && (
        <div className="modal-backdrop">
          <section className="modal-card reward">
            <img src={iconSrc(drawResult.reward_card.icon_key)} alt="" className="draw-card-icon" />
            <h2 className="hero-title-row"><UiIcon name="star" className="title-icon" /> 抽卡成功</h2>
            <p className="icon-meta"><UiIcon name="coin" /> 花費 {drawResult.cost} 金幣</p>
            <p>你抽中了「{drawResult.reward_card.title}」</p>
            <button className="primary-btn compact" type="button" onClick={() => setDrawResult(null)}>
              收藏到寶庫
            </button>
          </section>
        </div>
      )}

      <section className="white-card treasury-head treasury-section home-card">
        <h2 className="hero-title-row treasury-page-title"><UiIcon name="bag" className="title-icon" />國庫卡牌池</h2>
        <p>完成任務累積金幣，一起解鎖共讀群組的獎勵卡。</p>
      </section>

      <section className="white-card draw-card-panel treasury-section home-card">
        <div className="section-title blue treasury-page-title"><span /><UiIcon name="star" className="section-icon" />抽一張獎勵卡</div>
        <p>使用金幣從已啟用的卡牌池中隨機抽出一張獎勵卡。</p>
        <strong className="icon-meta card-cost treasury-card-cost"><UiIcon name="coin" /> 抽卡花費：{DRAW_COST} 金幣</strong>
        <button className="primary-btn compact inline-action" type="button" onClick={drawCard}>開始抽卡</button>
      </section>

      <section className="white-card treasury-section home-card">
        <div className="section-title pink treasury-page-title"><span /><UiIcon name="star" className="section-icon" />已啟用卡牌</div>
        <p className="section-note">這些卡牌已達到同意門檻，可以被抽到。</p>
        <div className="reward-card-grid">
          {activeCards.map((card) => (
            <article className="reward-card pool-card" key={card.id}>
              <CardBody card={card} rate={drawRate(card, activeTotalWeight)} />
            </article>
          ))}
          {!activeCards.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="star" className="empty-icon" />
              <p>目前還沒有可抽的獎勵卡。</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card treasury-section home-card">
        <div className="section-title pink treasury-page-title"><span /><UiIcon name="hourglass" className="section-icon" />等待同意的卡牌</div>
        <p className="section-note">卡牌達到一半以上成員同意後，就會自動加入國庫卡牌池。</p>
        <div className="reward-card-grid">
          {pendingCards.map((card) => (
            <article className="reward-card pending-card" key={card.id}>
              <CardBody card={card} />
              <div className="approval-row">
                <span className="icon-meta">
                  <UiIcon name="check" />
                  審核進度：{card.approval_count || 0} / {card.required_approvals || 0} 人同意
                </span>
                {approvalAction(card)}
              </div>
            </article>
          ))}
          {!pendingCards.length && (
            <div className="empty-text empty-with-icon">
              <UiIcon name="hourglass" className="empty-icon" />
              <p>目前沒有等待同意的卡牌。</p>
            </div>
          )}
        </div>
      </section>

      <section className="white-card treasury-head treasury-section home-card">
        <button className="primary-btn compact inline-action" type="button" onClick={() => setShowForm((open) => !open)}>
          <Plus size={17} /> 新增卡牌
        </button>
      </section>

      {showForm && (
        <section className="white-card form-card reward-form-card treasury-section home-card">
          <div className="section-title pink treasury-page-title"><span /><UiIcon name="pencil" className="section-icon" />新增獎勵卡</div>
          <form onSubmit={createCard}>
            <input
              placeholder="卡牌名稱，例如：休息 10 分鐘券"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              placeholder="卡牌說明，例如：可以讓自己休息 10 分鐘"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="two-inputs">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
              <select value={form.rarity} onChange={(e) => setForm({ ...form, rarity: e.target.value })}>
                {RARITIES.map((rarity) => <option key={rarity}>{rarity}</option>)}
              </select>
            </div>
            <div className="readonly-reward"><UiIcon name="coin" /> 系統會依稀有度設定權重：{DEFAULT_WEIGHTS[form.rarity]}</div>
            <button className="primary-btn compact" type="submit">送出卡牌申請</button>
          </form>
        </section>
      )}
    </div>
  );
}

function CardBody({ card, rate }) {
  const approved = Number(card.approval_count || 0);
  const required = Number(card.required_approvals || 0);
  const isActive = card.status === 'active' || Number(card.is_active) === 1;

  return (
    <div className="reward-card-content">
      <img src={iconSrc(card.icon_key)} alt="" className="treasure-icon" />
      <div className="reward-card-main">
        <div className="reward-card-head">
          <h3 className="treasury-card-title reward-card-title">{card.title}</h3>
          <span className={`rarity-tag rarity-${card.rarity}`}>{card.rarity}</span>
        </div>
        <p className="treasury-card-description reward-card-description">{card.description || '沒有卡牌說明'}</p>
        <div className="card-meta treasury-card-meta reward-card-meta">
          <span className="icon-meta"><UiIcon name="bag" /> {card.category}</span>
          <span className="icon-meta"><UiIcon name="coin" /> 權重 {card.weight}</span>
          {rate && <span className="icon-meta"><UiIcon name="star" /> 抽中率 {rate}</span>}
          <span className="icon-meta"><UiIcon name={isActive ? 'check' : 'hourglass'} /> {isActive ? '已加入國庫' : '等待同意'}</span>
          {required > 0 && <span className="icon-meta"><UiIcon name="heart" /> {approved} / {required} 人同意</span>}
        </div>
        <small className="treasury-card-meta reward-card-meta">建立者：{card.created_by_nickname || card.creator_name || '未知'} ｜ 建立時間：{card.created_at}</small>
      </div>
    </div>
  );
}
