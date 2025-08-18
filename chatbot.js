require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { VectorService } = require('./services/vectorService');
const { LLMService } = require('./services/llmService');
const { ChatService } = require('./services/chatService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const vectorService = new VectorService();
const llmService = new LLMService();
const chatService = new ChatService(vectorService, llmService);

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await chatService.processMessage(message, sessionId);
    res.json(response);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', async (req, res) => {
  const ollamaStatus = await llmService.checkOllamaStatus();
  res.json({ 
    status: 'healthy',
    ollama: ollamaStatus ? 'running' : 'offline'
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await vectorService.getStats();
    const ollamaStatus = await llmService.checkOllamaStatus();
    res.json({
      ...stats,
      llmStatus: ollamaStatus ? 'online' : 'offline'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.listen(PORT, async () => {
  console.log(`Chatbot server running on port ${PORT}`);
  const ollamaStatus = await llmService.checkOllamaStatus();
  console.log(`Ollama status: ${ollamaStatus ? 'Running' : 'Offline - run "ollama serve" to start'}`);
});