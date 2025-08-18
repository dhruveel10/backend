const { Pinecone } = require('@pinecone-database/pinecone');
const { spawn } = require('child_process');
const path = require('path');

class VectorService {
  constructor() {
    this.pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    this.index = this.pc.index('bull-ai-v2');
  }

  async generateEmbedding(text) {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [path.join(__dirname, '../generate_embeddings.py')], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let output = '';
      let error = '';
      
      python.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Embedding generation failed: ${error}`));
          return;
        }
        
        try {
          const embedding = JSON.parse(output.trim());
          resolve(embedding);
        } catch (e) {
          reject(new Error(`Failed to parse embedding: ${e.message}`));
        }
      });
      
      python.stdin.write(text);
      python.stdin.end();
    });
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
        vector: new Array(512).fill(0),
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