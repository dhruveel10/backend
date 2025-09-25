class ChatService {
  constructor(vectorService, llmService, sessionService = null) {
    this.vectorService = vectorService;
    this.llmService = llmService;
    this.sessions = new Map();
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

}

module.exports = { ChatService };