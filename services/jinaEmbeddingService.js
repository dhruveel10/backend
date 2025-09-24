const axios = require('axios');

class JinaEmbeddingService {
  constructor() {
    this.apiUrl = 'https://api.jina.ai/v1/embeddings';
    this.model = 'jina-embeddings-v3';
    this.apiKey = process.env.JINA_API_KEY;
    
    if (!this.apiKey) {
      console.warn('JINA_API_KEY not found. Using fallback embedding service.');
    }
  }

  async generateEmbeddings(texts) {
    if (!this.apiKey) {
      return this.generateFallbackEmbeddings(texts);
    }

    try {
      const textArray = Array.isArray(texts) ? texts : [texts];
      const cleanedTexts = textArray.map(text => this.cleanText(text));
      
      const response = await axios.post(this.apiUrl, {
        model: this.model,
        task: "text-matching",
        input: cleanedTexts
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.data && response.data.data) {
        return response.data.data.map(item => item.embedding);
      } else {
        throw new Error('Invalid response format from Jina API');
      }

    } catch (error) {
      console.error('Jina embedding error:', error.message);
      
      console.log('Falling back to hash-based embeddings...');
      return this.generateFallbackEmbeddings(Array.isArray(texts) ? texts : [texts]);
    }
  }

  async generateSingleEmbedding(text) {
    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0];
  }

  generateFallbackEmbeddings(texts) {
    const embeddings = texts.map(text => this.hashToVector(text, 1024));
    return embeddings;
  }

  hashToVector(text, dimensions = 1024) {
    const vector = new Array(dimensions).fill(0);
    
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = (charCode + i) % dimensions;
      vector[index] += Math.sin(charCode * 0.01 + i * 0.001);
    }
    
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = vector[i] / magnitude;
      }
    }
    
    return vector;
  }

  async processBatch(texts, batchSize = 10) {
    const results = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      console.log(`Processing embedding batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(texts.length/batchSize)}`);
      
      try {
        const embeddings = await this.generateEmbeddings(batch);
        results.push(...embeddings);
        
        if (i + batchSize < texts.length) {
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
        const fallbackEmbeddings = this.generateFallbackEmbeddings(batch);
        results.push(...fallbackEmbeddings);
      }
    }
    
    return results;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,!?-]/g, '')
      .trim()
      .substring(0, 8192);
  }

  async checkApiStatus() {
    if (!this.apiKey) {
      return { status: 'no_api_key', message: 'No Jina API key provided' };
    }

    try {
      const response = await axios.post(this.apiUrl, {
        model: this.model,
        task: "text-matching",
        input: ["test"]
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.status === 200) {
        return { status: 'connected', message: 'Jina API is working' };
      }
    } catch (error) {
      console.log('Full error response:', error.response?.data);
      return { 
        status: 'error', 
        message: `Jina API error: ${error.response?.data?.detail || error.response?.data?.error?.message || error.message}` 
      };
    }
  }
}

module.exports = { JinaEmbeddingService };