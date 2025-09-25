require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { VectorService } = require('./services/vectorService');
const { LLMService } = require('./services/llmService');
const { ChatService } = require('./services/chatService');
const { SessionService } = require('./services/sessionService');

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
    
    if (isFirstMessage) {
      const title = sessionService.generateTitleFromMessage({ text: message });
      await sessionService.setSessionTitle(sessionId, title);
    }

    const response = await chatService.processMessage(message, sessionId);
    
    await sessionService.addMessage(sessionId, { 
      text: response.response,
      sources: response.sources,
      chart: response.chart 
    }, false);

    try {
      const title = await sessionService.getSessionTitle(sessionId);
      const transcriptId = await chatService.saveSessionTranscript(sessionId, title);
    } catch (autoSaveError) {
      console.error(' REST API: Auto-save to transcript failed:', autoSaveError.message);
    }

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
    const transcriptStats = await chatService.getTranscriptStats();
    res.json({
      ...stats,
      llmStatus: geminiStatus ? 'online' : 'offline',
      sessions: sessionStats,
      transcripts: transcriptStats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.post('/api/transcripts/save', async (req, res) => {
  try {
    const { sessionId, title } = req.body;
    
    if (!sessionId) {
      console.error('No session ID provided');
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const transcriptId = await chatService.saveSessionTranscript(sessionId, title);
    
    if (!transcriptId) {
      return res.status(400).json({ error: 'No conversation history found for this session' });
    }

    res.json({ transcriptId, message: 'Transcript saved successfully' });
  } catch (error) {
    console.error('Save transcript error:', error);
    res.status(500).json({ error: 'Failed to save transcript' });
  }
});

app.get('/api/transcripts', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const parsedLimit = parseInt(limit) || 50;
    const parsedOffset = parseInt(offset) || 0;
    
    const transcripts = await chatService.getAllTranscripts(parsedLimit, parsedOffset);
    
    res.json({ transcripts });
  } catch (error) {
    console.error('Get transcripts error:', error);
    res.status(500).json({ error: 'Failed to get transcripts' });
  }
});

app.get('/api/transcripts/:transcriptId', async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const transcript = await chatService.getTranscript(transcriptId);
    
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json({ transcript });
  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(500).json({ error: 'Failed to get transcript' });
  }
});

app.get('/api/session/:sessionId/transcripts', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 10 } = req.query;
    const parsedLimit = parseInt(limit) || 10;
    const transcripts = await chatService.getTranscriptsBySession(sessionId, parsedLimit);
    res.json({ transcripts });
  } catch (error) {
    console.error('Get session transcripts error:', error);
    res.status(500).json({ error: 'Failed to get session transcripts' });
  }
});

app.get('/api/transcripts/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const transcripts = await chatService.searchTranscripts(query.trim());
    res.json({ transcripts, query: query.trim() });
  } catch (error) {
    console.error('Search transcripts error:', error);
    res.status(500).json({ error: 'Failed to search transcripts' });
  }
});

app.delete('/api/transcripts/:transcriptId', async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const deleted = await chatService.deleteTranscript(transcriptId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.json({ message: 'Transcript deleted successfully' });
  } catch (error) {
    console.error('Delete transcript error:', error);
    res.status(500).json({ error: 'Failed to delete transcript' });
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
      
      if (isFirstMessage) {
        const title = sessionService.generateTitleFromMessage({ text: message });
        await sessionService.setSessionTitle(currentSessionId, title);
      }

      socket.emit('bot-typing', { sessionId: currentSessionId });
      
      const response = await chatService.processMessage(message, currentSessionId);
      
      await sessionService.addMessage(currentSessionId, { 
        text: response.response,
        sources: response.sources,
        chart: response.chart 
      }, false);
      
      try {
        const title = await sessionService.getSessionTitle(currentSessionId);
        const transcriptId = await chatService.saveSessionTranscript(currentSessionId, title);
        if (!transcriptId) {
          console.log('Socket: No transcript created (likely no history)');
        }
      } catch (autoSaveError) {
        console.error('Socket: Auto-save to transcript failed:', autoSaveError.message);
      }

      socket.emit('bot-typing-stop', { sessionId: currentSessionId });
      
      const words = response.response.split(' ');
      let currentText = '';
      
      for (let i = 0; i < words.length; i++) {
        currentText += (i > 0 ? ' ' : '') + words[i];
        
        socket.emit('message-stream', {
          text: currentText,
          isComplete: i === words.length - 1,
          sources: i === words.length - 1 ? response.sources : [],
          chart: i === words.length - 1 ? response.chart : null,
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

server.listen(PORT, async () => {
  console.log(`Chatbot server running on port ${PORT}`);
  console.log(`Socket.IO server enabled with CORS for frontend`);
  const geminiStatus = await llmService.checkGeminiStatus();
  console.log(`Gemini API status: ${geminiStatus ? 'Connected' : 'Offline - check GEMINI_API_KEY'}`);
});