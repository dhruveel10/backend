const { TranscriptService } = require('./transcriptService');

class ChatService {
  constructor(vectorService, llmService, sessionService = null) {
    this.vectorService = vectorService;
    this.llmService = llmService;
    this.sessions = new Map();
    this.transcriptService = new TranscriptService();
    this.sessionService = sessionService; 
  }

  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        history: [],
        context: []
      });
    }
    return this.sessions.get(sessionId);
  }

  addToHistory(sessionId, role, content) {
    const session = this.getSession(sessionId);
    session.history.push({ role, content });
    
    if (session.history.length > 10) {
      session.history = session.history.slice(-10);
    }
  }

  async processMessage(message, sessionId = 'default') {
    
    try {
      const session = this.getSession(sessionId);
      
      const searchResults = await this.vectorService.searchSimilar(message, 15);
      const filteredResults = this.removeDuplicates(searchResults);
      
      const response = await this.llmService.generateResponse(
        message, 
        filteredResults, 
        session.history
      );

      this.addToHistory(sessionId, 'user', message);
      this.addToHistory(sessionId, 'assistant', response);
      
      return {
        response,
        sources: filteredResults.map(r => ({
          source: r.source,
          score: r.score
        }))
      };
    } catch (error) {
      console.error('Chat processing error:', error);
      return {
        response: 'I apologize, but I encountered an error processing your request. Please try again.',
        sources: []
      };
    }
  }













  removeDuplicates(results) {
    const seen = new Set();
    return results.filter(result => {
      const key = result.text.substring(0, 100);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }


  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSessionHistory(sessionId) {
    const session = this.getSession(sessionId);
    return session.history;
  }

  async saveSessionTranscript(sessionId, title = null) {
    
    try {
      let conversationHistory = [];
      
      if (conversationHistory.length === 0) {
        console.log(' No conversation history found for session:', sessionId);
        return null;
      }

      const messages = conversationHistory.map(message => ({
        role: message.isUser ? 'user' : 'assistant',
        content: message.text,
        timestamp: message.timestamp || new Date().toISOString(),
        sources: message.sources || []
      }));
      
      const transcriptId = await this.transcriptService.saveTranscript(sessionId, messages, title);
      console.log(`Transcript saved successfully for session ${sessionId}: ${transcriptId}`);
      
      return transcriptId;
    } catch (error) {
      console.error('Failed to save session transcript:', error.message);
      throw error;
    }
  }

  async getTranscript(transcriptId) {
    try {
      return await this.transcriptService.getTranscript(transcriptId);
    } catch (error) {
      console.error('Failed to get transcript:', error.message);
      throw error;
    }
  }

  async getTranscriptsBySession(sessionId) {
    try {
      return await this.transcriptService.getTranscriptsBySession(sessionId);
    } catch (error) {
      console.error('Failed to get transcripts by session:', error.message);
      throw error;
    }
  }

  async getAllTranscripts(limit = 50, offset = 0) {
    try {
      return await this.transcriptService.getAllTranscripts(limit, offset);
    } catch (error) {
      console.error('Failed to get all transcripts:', error.message);
      throw error;
    }
  }

  async searchTranscripts(query) {
    try {
      return await this.transcriptService.searchTranscripts(query);
    } catch (error) {
      console.error('Failed to search transcripts:', error.message);
      throw error;
    }
  }

  async deleteTranscript(transcriptId) {
    try {
      return await this.transcriptService.deleteTranscript(transcriptId);
    } catch (error) {
      console.error('Failed to delete transcript:', error.message);
      throw error;
    }
  }

  async getTranscriptStats() {
    try {
      return await this.transcriptService.getStats();
    } catch (error) {
      console.error('Failed to get transcript stats:', error.message);
      throw error;
    }
  }
}

module.exports = { ChatService };