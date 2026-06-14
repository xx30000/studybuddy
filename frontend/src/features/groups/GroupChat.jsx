import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import {
  deleteGroupChatMessage,
  getGroupChatMessages,
  sendGroupChatMessage,
} from '../../lib/api.js';
import { UiIcon } from '../../lib/icons.js';

function formatChatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function avatarLabel(name) {
  return (name || '用').trim().slice(0, 1);
}

function isChatNearBottom(chatBox) {
  if (!chatBox) return false;
  return chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
}

function scrollChatToBottom(chatBox) {
  if (!chatBox) return;
  chatBox.scrollTop = chatBox.scrollHeight;
}

export default function GroupChat({
  currentGroup,
  user,
  latestAnnouncement = null,
  setToast,
}) {
  const groupId = currentGroup?.id;
  const userId = user?.id;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false);
  const chatMessagesRef = useRef(null);

  const announcementText = latestAnnouncement?.content || currentGroup?.announcement || '';

  const loadMessages = useCallback(async (showLoading = false) => {
    if (!groupId || !userId) {
      setMessages([]);
      return;
    }

    const chatBox = chatMessagesRef.current;
    const wasNearBottom = isChatNearBottom(chatBox);

    if (showLoading) setIsLoading(true);
    try {
      const data = await getGroupChatMessages(groupId, userId, 50);
      setMessages(data.messages || []);
      if (wasNearBottom) {
        setShouldAutoScroll(true);
      }
    } catch (error) {
      setToast?.(error.message || '聊天室訊息載入失敗', 'error');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [groupId, userId, setToast]);

  useEffect(() => {
    loadMessages(true);
    if (!groupId || !userId) return undefined;
    const timer = window.setInterval(() => {
      loadMessages(false);
    }, 25000);
    return () => window.clearInterval(timer);
  }, [groupId, userId, loadMessages]);

  useEffect(() => {
    if (!shouldAutoScroll) return;
    scrollChatToBottom(chatMessagesRef.current);
    setShouldAutoScroll(false);
  }, [messages, shouldAutoScroll]);

  async function handleSend() {
    const message = draft.trim();
    if (!message) {
      setToast?.('訊息不可空白', 'error');
      return;
    }
    if (message.length > 500) {
      setToast?.('訊息最多 500 字', 'error');
      return;
    }
    setIsSending(true);
    try {
      const data = await sendGroupChatMessage(groupId, userId, message);
      setDraft('');
      setShouldAutoScroll(true);
      if (data.chat_message) {
        setMessages((prev) => [...prev, data.chat_message]);
      } else {
        await loadMessages(false);
      }
    } catch (error) {
      setToast?.(error.message || '訊息送出失敗', 'error');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  async function handleDelete(messageId) {
    const wasNearBottom = isChatNearBottom(chatMessagesRef.current);
    try {
      await deleteGroupChatMessage(groupId, messageId, userId);
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
      if (wasNearBottom) {
        setShouldAutoScroll(true);
      }
      setToast?.('訊息已刪除', 'success', `chat-message-deleted:${userId}:${messageId}`);
    } catch (error) {
      setToast?.(error.message || '訊息刪除失敗', 'error');
    }
  }

  if (!groupId || !userId) return null;

  return (
    <section className="home-card group-chat-card">
      <div className="group-chat-header">
        <div className="section-title-row">
          <UiIcon name="message" className="section-icon" />
          <h2 className="group-chat-title">群組聊天室</h2>
        </div>
      </div>

      <div className="group-chat-announcement">
        <span className="group-chat-announcement-label">公告提醒</span>
        <p className="group-chat-announcement-content">
          {announcementText || '目前尚未設定群組公告'}
        </p>
      </div>

      <div className="group-chat-messages" aria-live="polite" ref={chatMessagesRef}>
        {isLoading ? (
          <div className="group-chat-loading">聊天室訊息載入中...</div>
        ) : messages.length === 0 ? (
          <div className="group-chat-empty">目前還沒有訊息，送出第一句話吧。</div>
        ) : (
          messages.map((message) => {
            const mine = String(message.user_id) === String(userId);
            return (
              <article
                key={message.id}
                className={`group-chat-message ${mine ? 'mine' : 'other'}`}
              >
                <div className="group-chat-avatar" aria-hidden="true">
                  {message.avatar_data ? (
                    <img src={message.avatar_data} alt="" />
                  ) : (
                    <span>{avatarLabel(message.display_name)}</span>
                  )}
                </div>

                <div className="group-chat-bubble">
                  <div className="group-chat-meta">
                    <span className="group-chat-name">
                      {mine ? '我' : message.display_name || '使用者'}
                    </span>
                    <span className="group-chat-time">{formatChatTime(message.created_at)}</span>
                    {mine && (
                      <button
                        type="button"
                        className="group-chat-delete-button"
                        onClick={() => handleDelete(message.id)}
                        aria-label="刪除訊息"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <p className="group-chat-text">{message.message}</p>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="group-chat-form">
        <textarea
          className="group-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入訊息..."
          maxLength={500}
          rows={2}
        />
        <button
          type="button"
          className="group-chat-send-button"
          onClick={handleSend}
          disabled={isSending || !draft.trim()}
        >
          <Send size={17} />
          {isSending ? '送出中' : '送出'}
        </button>
      </div>
    </section>
  );
}
