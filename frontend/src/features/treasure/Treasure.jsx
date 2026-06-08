import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';

const CATEGORIES = ['學習輔助', '休息獎勵', '組員協助', '特殊權利', '娛樂放鬆'];
const RARITIES = ['普通', '稀有', '史詩', '傳說'];
const DEFAULT_WEIGHTS = {
  普通: 60,
  稀有: 25,
  史詩: 10,
  傳說: 5,
};
const DRAW_COST = 50;

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
    if (!form.title.trim()) return setToast('請輸入卡牌名稱');

    await api(`/groups/${session.group.id}/reward-cards`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        created_by: session.user.id,
      }),
    });
    setToast('已提出卡牌申請');
    setForm({ title: '', description: '', category: '休息獎勵', rarity: '普通' });
    setShowForm(false);
    refresh();
  }

  async function approveCard(card) {
    const data = await api(`/reward-cards/${card.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ user_id: session.user.id }),
    });
    setToast(data.message);
    refresh();
  }

  async function drawCard() {
    try {
      const data = await api(`/groups/${session.group.id}/draw-card`, {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id }),
      });
      setDrawResult(data);
      refresh();
    } catch (err) {
      setToast(err.message);
    }
  }

  function approvalAction(card) {
    if (Number(card.created_by) === Number(session.user.id)) {
      return <span className="approval-note">等待其他成員同意</span>;
    }
    if (card.current_user_approved) {
      return <span className="approval-note">已同意</span>;
    }
    return <button onClick={() => approveCard(card)}>同意加入卡牌池</button>;
  }

  return (
    <div className="page-stack">
      {drawResult && (
        <div className="modal-backdrop">
          <section className="modal-card reward">
            <h2>抽卡成功！</h2>
            <p>花費 {drawResult.cost} 金幣</p>
            <p>抽中獎勵卡：「{drawResult.reward_card.title}」</p>
            <button className="primary-btn compact" onClick={() => setDrawResult(null)}>太棒了！</button>
          </section>
        </div>
      )}

      <section className="white-card treasury-head">
        <h2>國庫卡牌池</h2>
        <p>完成任務獲得金幣後，可以花費金幣從卡牌池中抽取獎勵卡。</p>
      </section>

      <section className="white-card draw-card-panel">
        <div className="section-title blue"><span />抽取獎勵卡牌</div>
        <p>花費金幣後，可從國庫卡牌池中隨機抽取一張獎勵卡。</p>
        <strong>抽卡費用：{DRAW_COST} 金幣</strong>
        <button className="primary-btn compact inline-action" onClick={drawCard}>確認抽卡</button>
      </section>

      <section className="white-card">
        <div className="section-title pink"><span />已啟用卡牌</div>
        <p className="section-note">這些卡牌已通過同意，可以被抽中。</p>
        <div className="reward-card-grid">
          {activeCards.map((card) => (
            <article className="reward-card pool-card" key={card.id}>
              <CardBody card={card} rate={drawRate(card, activeTotalWeight)} />
            </article>
          ))}
          {!activeCards.length && <p className="empty-text">目前沒有可抽取的獎勵卡牌</p>}
        </div>
      </section>

      <section className="white-card">
        <div className="section-title pink"><span />待同意卡牌</div>
        <p className="section-note">群組成員同意後，卡牌才會加入國庫卡牌池。</p>
        <div className="reward-card-grid">
          {pendingCards.map((card) => (
            <article className="reward-card pending-card" key={card.id}>
              <CardBody card={card} />
              <div className="approval-row">
                <span>同意進度：{card.approval_count || 0} / {card.required_approvals || 0}</span>
                {approvalAction(card)}
              </div>
            </article>
          ))}
          {!pendingCards.length && <p className="empty-text">目前沒有待同意卡牌</p>}
        </div>
      </section>

      <section className="white-card treasury-head">
        <button className="primary-btn compact inline-action" onClick={() => setShowForm((open) => !open)}>
          <Plus size={17} /> 新增卡牌
        </button>
      </section>

      {showForm && (
        <section className="white-card form-card reward-form-card">
          <div className="section-title pink"><span />新增獎勵卡牌</div>
          <form onSubmit={createCard}>
            <input
              placeholder="例如：休息 10 分鐘券"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              placeholder="例如：可以讓自己休息 10 分鐘"
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
            <div className="readonly-reward">系統自動設定權重：{DEFAULT_WEIGHTS[form.rarity]}</div>
            <button className="primary-btn compact" type="submit">提出卡牌申請</button>
          </form>
        </section>
      )}
    </div>
  );
}

function CardBody({ card, rate }) {
  return (
    <>
      <div className="reward-card-head">
        <h3>{card.title}</h3>
        <span className={`rarity-tag rarity-${card.rarity}`}>{card.rarity}</span>
      </div>
      <p>{card.description || '沒有卡牌說明'}</p>
      <div className="card-meta">
        <span>{card.category}</span>
        <span>權重 {card.weight}</span>
        {rate && <span>機率 {rate}</span>}
        <span>{card.status === 'active' ? '已啟用' : '待同意'}</span>
      </div>
      <small>建立者：{card.creator_name || '未知'} · 建立時間：{card.created_at}</small>
    </>
  );
}
