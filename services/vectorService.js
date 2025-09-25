const { Pinecone } = require('@pinecone-database/pinecone');
const { JinaEmbeddingService } = require('./jinaEmbeddingService');

class VectorService {
  constructor() {
    this.pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    this.index = this.pc.index('news-chatbot-rag');
    
    this.jinaEmbedding = new JinaEmbeddingService();
  }

  async generateEmbedding(text) {
    try {
      return await this.jinaEmbedding.generateSingleEmbedding(text);
    } catch (error) {
      console.error('Jina embedding error:', error.message);
      return this.createFallbackEmbedding(text);
    }
  }

  createFallbackEmbedding(text) {
    const embedding = new Array(1024).fill(0); 
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    for (let i = 0; i < words.length && i < 1024; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = ((hash << 5) - hash + word.charCodeAt(j)) & 0x7fffffff;
      }
      
      const index = hash % 1024;
      embedding[index] += 1 / Math.sqrt(words.length);
    }
    
    for (let i = 0; i < Math.min(text.length, 1024); i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] += (charCode / 255 - 0.5) * 0.1;
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
  }

  async searchSimilar(query, topK = 10) {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      
      const results = await this.index.query({
        vector: queryEmbedding,
        topK: topK,
        includeMetadata: true
      });
      
      return results.matches.map(match => ({
        score: match.score,
        text: match.metadata.text || match.metadata.chunkContent,
        source: match.metadata.source,
        title: match.metadata.title,
        url: match.metadata.url,
        category: match.metadata.category,
        publishDate: match.metadata.publishDate,
        chunkIndex: match.metadata.chunkIndex || match.metadata.chunk
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

  async storeNewsArticles(articles) {
    try {
      console.log(`Storing ${articles.length} news articles in vector database...`);
      const vectors = [];
      
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        
        try {
          console.log(`Processing article ${i + 1}/${articles.length}: ${article.title?.substring(0, 50)}...`);
          
          const embedding = await this.generateEmbedding(article.chunkContent || article.content);
          
          vectors.push({
            id: article.id,
            values: embedding,
            metadata: {
              title: article.title,
              text: article.chunkContent || article.content,
              chunkContent: article.chunkContent || article.content,
              source: article.source,
              url: article.url,
              category: article.category,
              publishDate: article.publishDate,
              summary: article.summary,
              chunk: article.chunk || 0,
              chunkIndex: article.chunk || 0
            }
          });
          
          if (vectors.length >= 50) {
            await this.index.upsert(vectors);
            console.log(`Uploaded batch of ${vectors.length} vectors`);
            vectors.length = 0; 
            
            await this.sleep(500);
          }
        } catch (error) {
          console.error(`Failed to process article ${i + 1}:`, error.message);
        }
      }
      
      if (vectors.length > 0) {
        await this.index.upsert(vectors);
        console.log(`Uploaded final batch of ${vectors.length} vectors`);
      }
      
      console.log('All news articles stored successfully!');
      return { success: true, count: articles.length };
      
    } catch (error) {
      console.error('Failed to store articles:', error.message);
      throw new Error(`Vector storage failed: ${error.message}`);
    }
  }

  async searchBySource(sourceName, topK = 10) {
    try {
      const results = await this.index.query({
        vector: new Array(1024).fill(0), 
        topK: topK,
        includeMetadata: true,
        filter: {
          source: { $eq: sourceName }
        }
      });
      
      return results.matches.map(match => ({
        text: match.metadata.text || match.metadata.chunkContent,
        title: match.metadata.title,
        chunkIndex: match.metadata.chunkIndex || match.metadata.chunk
      }));
    } catch (error) {
      throw new Error(`Source search failed: ${error.message}`);
    }
  }

  async searchByCategory(category, topK = 10) {
    try {
      const results = await this.index.query({
        vector: new Array(1024).fill(0),
        topK: topK,
        includeMetadata: true,
        filter: {
          category: { $eq: category }
        }
      });
      
      return results.matches.map(match => ({
        text: match.metadata.text || match.metadata.chunkContent,
        title: match.metadata.title,
        source: match.metadata.source,
        url: match.metadata.url
      }));
    } catch (error) {
      throw new Error(`Category search failed: ${error.message}`);
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { VectorService };