const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        maxOutputTokens: 1200,
      }
    });
    this.isInitialized = false;
  }

  async initializeModel() {
    try {
      const testResult = await this.model.generateContent("Hello");
      this.isInitialized = true;
      console.log('Gemini API initialized successfully');
      return true;
    } catch (error) {
      console.error('Gemini API initialization failed:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  async generateResponse(query, context, conversationHistory = []) {
    try {
      if (!this.isInitialized) {
        await this.initializeModel();
      }

      if (context.length === 0) {
        return "I don't have access to any documents in the database. Please ensure documents are properly uploaded and indexed.";
      }

      const contextText = context.map(item => item.text).join('\n\n');
      const sources = [...new Set(context.map(item => item.source))];

      const systemPrompt = `You are a news analyst with access to current news articles and documents. Answer based only on the provided context.

Context from documents:
${contextText}

Available sources: ${sources.join(', ')}

Guidelines:
- Answer only based on the provided context
- If information is not in the context, say "This information is not available in the provided documents"
- Provide accurate news information and analysis
- Cite sources and dates when available
- Focus on news content, current events, and factual reporting`;

      const conversationContext = conversationHistory.length > 0 
        ? `\n\nPrevious conversation:\n${conversationHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
        : '';

      const fullPrompt = `${systemPrompt}${conversationContext}\n\nUser question: ${query}\n\nAssistant:`;

      const result = await this.model.generateContent(fullPrompt);
      const response = result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Gemini API error:', error.message);
      return this.getFallbackResponse(query, context);
    }
  }

  getFallbackResponse(query, context) {
    if (context.length === 0) {
      return "I don't have access to any documents. Please ensure the vector database is properly populated.";
    }

    const sources = [...new Set(context.map(item => item.source))];
    return `Based on available documents (${sources.join(', ')}), I can provide information but the AI service is currently limited. Please try rephrasing your question.`;
  }

  async checkGeminiStatus() {
    try {
      const result = await this.model.generateContent("test");
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkOllamaStatus() {
    return await this.checkGeminiStatus();
  }
}

module.exports = { LLMService };