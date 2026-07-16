import React, { useState } from 'react';
import { Sparkles, Bot, Send, X } from 'lucide-react';
import { fetchJson } from '../utils/api';

export default function RiskChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'ai',
      text: '안녕하세요! PortPulse AI입니다. 부킹 리스크에 대해 무엇이든 물어보세요.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  const suggestions = [
    '왜 리스크가 높아?',
    '2주 뒤에 부킹하면 어때?'
  ];

  async function handleSend(text) {
    if (!text.trim()) return;

    const userMessage = { role: 'user', text: text.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const firstUserIndex = messages.findIndex((message) => message.role === 'user');
      const conversation = firstUserIndex >= 0 ? messages.slice(firstUserIndex) : [];
      const history = conversation.slice(-10).map((message) => ({
        role: message.role === 'ai' ? 'assistant' : 'user',
        content: message.text,
      }));
      const result = await fetchJson('/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userMessage.text, history, sessionId }),
      });
      if (result.sessionId) setSessionId(result.sessionId);
      setMessages((prev) => [...prev, { role: 'ai', text: result.reply, model: result.model }]);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'ai', text: error.message || 'AI 상담 연결에 실패했습니다.', error: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '32px',
          height: '56px',
          padding: '0 24px',
          borderRadius: '100px',
          background: 'var(--primary-color)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 40,
          transition: 'transform 0.2s',
          transform: isOpen ? 'scale(0)' : 'scale(1)',
          animation: 'glowPulse 2s infinite',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '16px'
        }}
      >
        <Sparkles size={24} />
        AI 리스크 상담
      </button>

      <div className="panel" style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '380px',
        borderRadius: 0,
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        zIndex: 50,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--primary-color)' }}>
            <Sparkles size={20} /> AI 리스크 상담
          </h3>
          <button onClick={() => setIsOpen(false)} style={{ color: 'var(--text-muted)' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '12px', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              {msg.role === 'ai' && (
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)', flexShrink: 0 }}>
                  <Bot size={16} />
                </div>
              )}
              
              <div style={{ 
                padding: '12px 16px', 
                borderRadius: '16px', 
                background: msg.role === 'user' ? 'var(--primary-color)' : 'var(--glass-bg)',
                borderTopRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderTopLeftRadius: msg.role === 'ai' ? '4px' : '16px',
                color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                fontSize: '14px',
                lineHeight: '1.5',
                border: msg.role === 'user' ? 'none' : '1px solid var(--border-color)'
              }}>
                {msg.text}
              </div>
            </div>
          ))}
          {sending && <div style={{ color: 'var(--text-muted)', fontSize: '13px', paddingLeft: '44px' }}>AI가 시장 데이터를 확인하고 있습니다...</div>}
        </div>

        <div style={{ padding: '0 20px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {suggestions.map((sug, idx) => (
            <button key={idx} disabled={sending} onClick={() => handleSend(sug)} style={{ padding: '6px 12px', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', borderRadius: '100px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {sug}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '12px', background: 'var(--bg-color)' }}>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !sending && handleSend(input)}
            placeholder="질문을 입력하세요..." 
            style={{ flex: 1, padding: '12px 16px', borderRadius: '100px', fontSize: '14px', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
          />
          <button disabled={sending} onClick={() => handleSend(input)} className="btn btn-primary" style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, opacity: sending ? 0.6 : 1 }}>
            <Send size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
