require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { VectorService } = require('./services/vectorService');
const { LLMService } = require('./services/llmService');
const { ChatService } = require('./services/chatService');
const { SessionService } = require('./services/sessionService');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

const vectorService = new VectorService();
const llmService = new LLMService();
const sessionService = new SessionService();
const chatService = new ChatService(vectorService, llmService);

app.post('/api/chat', async (req, res) => {
  try {
    let { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!sessionId) {
      sessionId = sessionService.generateSessionId();
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
    res.json({
      ...stats,
      llmStatus: geminiStatus ? 'online' : 'offline',
      sessions: sessionStats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.listen(PORT, async () => {
  console.log(`Chatbot server running on port ${PORT}`);
  const geminiStatus = await llmService.checkGeminiStatus();
  console.log(`Gemini API status: ${geminiStatus ? 'Connected' : 'Offline - check GEMINI_API_KEY'}`);
});