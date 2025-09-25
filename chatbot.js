require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { VectorService } = require('./services/vectorService');
const { LLMService } = require('./services/llmService');
const { ChatService } = require('./services/chatService');
const { SessionService } = require('./services/sessionService');
const { SessionStorageService } = require('./services/sessionStorageService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", process.env.FRONTEND_URL].filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true
  }
});
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

const vectorService = new VectorService();
const llmService = new LLMService();
const sessionService = new SessionService();
const sessionStorageService = new SessionStorageService();
const chatService = new ChatService(vectorService, llmService, sessionService);

app.post('/api/chat', async (req, res) => {
  try {
    let { message, sessionId } = req.body;
    
    if (!message) {
      console.error('No message provided');
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!sessionId) {
      sessionId = sessionService.generateSessionId();
    } else {
      console.log('Using existing sessionId:', sessionId);
    }

    const isFirstMessage = (await sessionService.getSessionHistory(sessionId, 1)).length === 0;
    
    await sessionService.addMessage(sessionId, { text: message }, true);
    await sessionStorageService.saveMessage(sessionId, message, 'user');
    
    if (isFirstMessage) {
      const title = sessionService.generateTitleFromMessage({ text: message });
      await sessionService.setSessionTitle(sessionId, title);
    }

    const response = await chatService.processMessage(message, sessionId);
    
    await sessionService.addMessage(sessionId, { 
      text: response.response,
      sources: response.sources,
    }, false);
    await sessionStorageService.saveMessage(sessionId, response.response, 'bot');

    res.json({
      ...response,
      sessionId
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/session/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;
    
    const exists = await sessionService.sessionExists(sessionId);
    if (!exists) {
      return res.status(404).json({ error: 'Session not found or expired', sessionId, exists: false });
    }
    
    const history = await sessionService.getSessionHistory(sessionId, parseInt(limit));
    res.json({ sessionId, history, exists: true });
  } catch (error) {
    console.error('Session history error:', error);
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});

app.get('/api/session/:sessionId/exists', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const exists = await sessionService.sessionExists(sessionId);
    res.json({ sessionId, exists });
  } catch (error) {
    console.error('Session exists error:', error);
    res.status(500).json({ error: 'Failed to check session existence' });
  }
});

app.delete('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await sessionService.clearSession(sessionId);
    res.json(result);
  } catch (error) {
    console.error('Clear session error:', error);
    res.status(500).json({ error: 'Failed to clear session' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await sessionService.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

app.get('/api/sessions/stored', async (req, res) => {
  try {
    const sessions = await sessionStorageService.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Get stored sessions error:', error);
    res.status(500).json({ error: 'Failed to get stored sessions' });
  }
});

app.get('/api/session/:sessionId/stored-history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;
    
    const history = await sessionStorageService.getSessionHistory(sessionId, parseInt(limit));
    res.json({ sessionId, history });
  } catch (error) {
    console.error('Get stored session history error:', error);
    res.status(500).json({ error: 'Failed to fetch stored session history' });
  }
});

app.get('/api/health', async (req, res) => {
  const geminiStatus = await llmService.checkGeminiStatus();
  res.json({ 
    status: 'healthy',
    gemini: geminiStatus ? 'running' : 'offline'
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await vectorService.getStats();
    const geminiStatus = await llmService.checkGeminiStatus();
    const sessionStats = await sessionService.getStats();
    const storageStats = await sessionStorageService.getStats();
    res.json({
      ...stats,
      llmStatus: geminiStatus ? 'online' : 'offline',
      sessions: sessionStats,
      storage: storageStats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});


app.post('/api/sessions/cleanup', async (req, res) => {
  try {
    const result = await sessionService.cleanupEmptySessions();
    res.json({
      message: `Cleaned up ${result.cleaned} empty sessions`,
      ...result
    });
  } catch (error) {
    console.error('Cleanup sessions error:', error);
    res.status(500).json({ error: 'Failed to cleanup sessions' });
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`User ${socket.id} joined session: ${sessionId}`);
  });
  
  socket.on('send-message', async (data) => {
    try {
      const { message, sessionId } = data;
      
      if (!message) {
        console.error('Socket: No message provided');
        socket.emit('error', { error: 'Message is required' });
        return;
      }

      let currentSessionId = sessionId;
      if (!currentSessionId) {
        currentSessionId = sessionService.generateSessionId();
      } else {
        console.log('Socket: Using existing sessionId:', currentSessionId);
      }

      const isFirstMessage = (await sessionService.getSessionHistory(currentSessionId, 1)).length === 0;
      
      await sessionService.addMessage(currentSessionId, { text: message }, true);
      await sessionStorageService.saveMessage(currentSessionId, message, 'user');
      
      if (isFirstMessage) {
        const title = sessionService.generateTitleFromMessage({ text: message });
        await sessionService.setSessionTitle(currentSessionId, title);
      }

      socket.emit('bot-typing', { sessionId: currentSessionId });
      
      const response = await chatService.processMessage(message, currentSessionId);
      
      await sessionService.addMessage(currentSessionId, { 
        text: response.response,
        sources: response.sources,
        }, false);
      await sessionStorageService.saveMessage(currentSessionId, response.response, 'bot');

      socket.emit('bot-typing-stop', { sessionId: currentSessionId });
      
      const words = response.response.split(' ');
      let currentText = '';
      
      for (let i = 0; i < words.length; i++) {
        currentText += (i > 0 ? ' ' : '') + words[i];
        
        socket.emit('message-stream', {
          text: currentText,
          isComplete: i === words.length - 1,
          sources: i === words.length - 1 ? response.sources : [],
          sessionId: currentSessionId
        });
        
        await new Promise(resolve => setTimeout(resolve, 50));
      }

    } catch (error) {
      console.error('Socket chat error:', error);
      socket.emit('error', { error: 'Internal server error' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

async function runMaintenanceTasks() {
  try {
    console.log('Running automatic session maintenance...');
    
    const emptyResult = await sessionService.cleanupEmptySessions();
    
    if (emptyResult.cleaned > 0 || emptyResult.errors.length > 0) {
      console.log(`Maintenance completed: ${emptyResult.cleaned} empty sessions cleaned, ${emptyResult.errors.length} errors`);
    }
    
    if (emptyResult.errors.length > 0) {
      console.warn('Maintenance errors:', emptyResult.errors);
    }
  } catch (error) {
    console.error('Maintenance task failed:', error);
  }
}

server.listen(PORT, async () => {
  console.log(`Chatbot server running on port ${PORT}`);
  console.log(`Socket.IO server enabled with CORS for frontend`);
  const geminiStatus = await llmService.checkGeminiStatus();
  console.log(`Gemini API status: ${geminiStatus ? 'Connected' : 'Offline - check GEMINI_API_KEY'}`);
  
  const maintenanceInterval = parseInt(process.env.MAINTENANCE_INTERVAL_HOURS) || 4;
  console.log(`Session cleanup will run every ${maintenanceInterval} hours`);
  
  setInterval(runMaintenanceTasks, maintenanceInterval * 60 * 60 * 1000);
  
  setTimeout(runMaintenanceTasks, 30000);
});