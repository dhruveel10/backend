const { Pinecone } = require('@pinecone-database/pinecone');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class VectorService {
  constructor() {
    this.pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    this.index = this.pc.index('financial-chatbot-v3');
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.embeddingModel = this.genAI.getGenerativeModel({ model: "embedding-001" });
  }

  async generateEmbedding(text) {
    try {
      const result = await this.embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Gemini embedding error:', error.message);
      return this.createFallbackEmbedding(text);
    }
  }

  createFallbackEmbedding(text) {
    const embedding = new Array(768).fill(0);
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    for (let i = 0; i < words.length && i < 768; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = ((hash << 5) - hash + word.charCodeAt(j)) & 0x7fffffff;
      }
      
      const index = hash % 768;
      embedding[index] += 1 / Math.sqrt(words.length);
    }
    
    for (let i = 0; i < Math.min(text.length, 768); i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] += (charCode / 255 - 0.5) * 0.1;
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
  }

  async searchSimilar(query, topK = 5) {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      
      const results = await this.index.query({
        vector: queryEmbedding,
        topK: topK,
        includeMetadata: true
      });
      
      return results.matches.map(match => ({
        score: match.score,
        text: match.metadata.text,
        source: match.metadata.source,
        chunkIndex: match.metadata.chunkIndex
      }));
    } catch (error) {
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  async getStats() {
    try {
      const stats = await this.index.describeIndexStats();
      return {
        totalVectors: stats.totalRecordCount,
        dimensions: stats.dimension,
        indexFullness: stats.indexFullness
      };
    } catch (error) {
      throw new Error(`Failed to get stats: ${error.message}`);
    }
  }

  async searchBySource(sourceName, topK = 10) {
    try {
      const results = await this.index.query({
        vector: new Array(768).fill(0),
        topK: topK,
        includeMetadata: true,
        filter: {
          source: { $eq: sourceName }
        }
      });
      
      return results.matches.map(match => ({
        text: match.metadata.text,
        chunkIndex: match.metadata.chunkIndex
      }));
    } catch (error) {
      throw new Error(`Source search failed: ${error.message}`);
    }
  }
}

module.exports = { VectorService };