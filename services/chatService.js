class ChatService {
  constructor(vectorService, llmService) {
    this.vectorService = vectorService;
    this.llmService = llmService;
    this.sessions = new Map();
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
      
      const [searchResults, chartIntent] = await Promise.all([
        this.vectorService.searchSimilar(message, 5),
        this.llmService.detectChartIntent(message)
      ]);

      const filteredResults = this.removeDuplicates(searchResults);
      
      let chartData = null;
      if (chartIntent.needsChart && chartIntent.dataPoints.length > 0) {
        chartData = await this.llmService.extractChartData(filteredResults, chartIntent.dataPoints);
      }

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
        })),
        chart: chartIntent.needsChart ? {
          type: chartIntent.chartType,
          data: chartData || [],
          title: this.generateChartTitle(message, chartIntent.chartType)
        } : null
      };
    } catch (error) {
      console.error('Chat processing error:', error);
      return {
        response: 'I apologize, but I encountered an error processing your request. Please try again.',
        sources: [],
        chart: null
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

  generateChartTitle(query, chartType) {
    const titles = {
      line: `Trend Analysis: ${query}`,
      bar: `Comparison: ${query}`,
      pie: `Distribution: ${query}`
    };
    return titles[chartType] || query;
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