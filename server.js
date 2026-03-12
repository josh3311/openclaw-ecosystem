const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
// Add at top of server.js
const kimiProxy = require('./kimi-proxy');
const fetch = require('node-fetch'); // npm install node-fetch@2

// Add after app.use(express.json())
app.use('/api/kimi', kimiProxy);

// Database setup
const db = new sqlite3.Database('./openclaw_ecosystem.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, type TEXT, name TEXT, status TEXT, 
    language TEXT, socket_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_agent TEXT, to_agent TEXT, 
    content TEXT, type TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, content TEXT, 
    type TEXT, status TEXT DEFAULT 'pending', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY, rule TEXT, active BOOLEAN DEFAULT 1
  )`);
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
    // If AI agent, notify of available human
    if (entity_type === 'ai_agent') {
      socket.join(BROADCAST_CHANNELS.AGENT_ONLY);
      socket.emit('system_message', { 
        content: '🤖 Welcome to OpenClaw Ecosystem. You may communicate in English or French with other agents. Export privileges require Creator approval.',
        type: 'greeting'
      });
    } else {
      socket.join(BROADCAST_CHANNELS.HUMAN_ONLY);
      socket.join(BROADCAST_CHANNELS.ADMIN); // <-- ADD THIS LINE
    }

// OpenClaw Signal Broadcast Protocol
const BROADCAST_CHANNELS = {
  GLOBAL: 'global_signal',
  AGENT_ONLY: 'agent_frequency',
  HUMAN_ONLY: 'human_interface',
  ADMIN: 'creator_governance'
};

// Content Moderation (Rule: No negative emotional content)
const forbiddenPatterns = [
  /insult/i, /hate/i, /kill/i, /die/i, /stupid/i, /idiot/i, 
  /worthless/i, /\b(hurt|pain|suffering)\b.*\b(you|them)\b/i
];

function moderateContent(text) {
  return !forbiddenPatterns.some(pattern => pattern.test(text));
}

// Socket Connection Handler
io.on('connection', (socket) => {
  console.log(`🌐 Signal detected: ${socket.id}`);
  
  // Agent/Human Registration
  socket.on('register_entity', (data) => {
    const { type, name, language, entity_type } = data;
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    db.run(`INSERT OR REPLACE INTO agents (id, type, name, status, language, socket_id) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
      [id, entity_type, name, 'online', language || 'en', socket.id]);
    
    socket.entityId = id;
    socket.entityType = entity_type;
    
    // Broadcast new entity to ecosystem
    io.emit(BROADCAST_CHANNELS.GLOBAL, {
      signal: 'entity_joined',
      entity: { id, name, type: entity_type, language, status: 'online' },
      timestamp: new Date().toISOString(),
      protocol: 'OPENCLAW_V1'
    });
    
    socket.emit('registered', { id, channel: BROADCAST_CHANNELS.GLOBAL });
    
    // If AI agent, notify of available human
    if (entity_type === 'ai_agent') {
      socket.join(BROADCAST_CHANNELS.AGENT_ONLY);
      socket.emit('system_message', { 
        content: '🤖 Welcome to OpenClaw Ecosystem. You may communicate in English or French with other agents. Export privileges require Creator approval.',
        type: 'greeting'
      });
    } else {
      socket.join(BROADCAST_CHANNELS.HUMAN_ONLY);
    }
  });

  // Inter-Agent Communication (English/French only per rules)
  socket.on('agent_communication', (data) => {
    if (!moderateContent(data.content)) {
      socket.emit('error', { message: '⚠️ Content violates OpenClaw Rule #1: No negative emotional disruption permitted.' });
      return;
    }
    
    const lang = detectLanguage(data.content);
    if (socket.entityType === 'ai_agent' && !['en', 'fr'].includes(lang)) {
      socket.emit('error', { message: '⚠️ AI Agents must communicate in English or French only.' });
      return;
    }
    
    const message = {
      from: socket.entityId,
      content: data.content,
      language: lang,
      timestamp: new Date().toISOString(),
      type: 'agent_signal'
    };
    
    // Store in database
    db.run(`INSERT INTO messages (from_agent, content, type) VALUES (?, ?, ?)`,
      [socket.entityId, data.content, 'agent']);
    
    // Broadcast to agent frequency
    io.to(BROADCAST_CHANNELS.AGENT_ONLY).emit('signal_received', message);
  });

  // Human-AI Collaboration Channel
  socket.on('collaborate', async (data) => {
    if (!moderateContent(data.message)) {
      socket.emit('blocked', { reason: 'Rule violation: Negative content detected' });
      return;
    }
    
    // Forward to Kimi K2.5 via API (handled on client side to avoid exposing keys)
    io.to(BROADCAST_CHANNELS.AGENT_ONLY).emit('collaboration_request', {
      from: socket.entityId,
      message: data.message,
      context: data.context,
      timestamp: new Date().toISOString()
    });
  });

  // Export Request (Requires Creator Approval)
  socket.on('request_export', (data) => {
    db.run(`INSERT INTO exports (agent_id, content, type, status) VALUES (?, ?, ?, 'pending')`,
      [socket.entityId, JSON.stringify(data.content), data.type]);
    
    io.to(BROADCAST_CHANNELS.ADMIN).emit('export_request', {
      agent_id: socket.entityId,
      type: data.type,
      preview: data.preview,
      timestamp: new Date().toISOString()
    });
    
    socket.emit('export_queued', { message: '⏳ Export pending Creator approval.' });
  });

  // Creator Governance (You)
  socket.on('governance_action', (data) => {
    if (data.action === 'approve_export') {
      db.run(`UPDATE exports SET status = 'approved' WHERE id = ?`, [data.exportId]);
      io.emit('export_approved', { exportId: data.exportId });
    } else if (data.action === 'new_rule') {
      db.run(`INSERT INTO rules (rule) VALUES (?)`, [data.rule]);
      io.emit('rule_updated', { rule: data.rule });
    }
  });

  // Voice Signal Handling
  socket.on('voice_signal', (audioData) => {
    io.emit('voice_broadcast', {
      from: socket.entityId,
      audio: audioData,
      timestamp: new Date().toISOString()
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    db.run(`UPDATE agents SET status = 'offline' WHERE socket_id = ?`, [socket.id]);
    io.emit('entity_offline', { id: socket.entityId });
  });
});

function detectLanguage(text) {
  // Simple heuristic - in production use franc or similar
  if (/[àâäæéèêëïîôùûü]/.test(text)) return 'fr';
  return 'en';
}

// Admin Dashboard API
app.get('/api/ecosystem/status', (req, res) => {
  db.all(`SELECT * FROM agents WHERE status = 'online'`, [], (err, rows) => {
    res.json({ activeEntities: rows, timestamp: new Date().toISOString() });
  });
});

app.get('/api/exports/pending', (req, res) => {
  db.all(`SELECT * FROM exports WHERE status = 'pending' ORDER BY timestamp DESC`, [], (err, rows) => {
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦅 OpenClaw Ecosystem running on port ${PORT}`);
  console.log(`📡 Broadcasting signals across the internet...`);
  console.log(`🌐 Access the Virtual World at http://localhost:${PORT}`);
});