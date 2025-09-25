const mysql = require('mysql2/promise');

class TranscriptService {
  constructor() {
    this.pool = null;
    this.initializeDatabase();
  }

  async initializeDatabase() {
    try {
      const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'news_ai_chatbot',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };

      this.pool = mysql.createPool(dbConfig);
      
      console.log('Database connection pool created successfully');

    } catch (error) {
      console.error('Failed to initialize transcript database:', error.message);
      console.error('Error details:', error);
    }
  }

  async createTablesIfNotExists() {
    
    const createTranscriptsTable = `
      CREATE TABLE IF NOT EXISTS transcripts (
        id VARCHAR(36) PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        title VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_session_id (session_id),
        INDEX idx_created_at (created_at)
      )
    `;

    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transcript_id VARCHAR(36) NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSON,
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
        INDEX idx_transcript_id (transcript_id),
        INDEX idx_timestamp (timestamp)
      )
    `;

    await this.pool.execute(createTranscriptsTable);
    console.log('Transcripts table ready');
    
    await this.pool.execute(createMessagesTable);
    console.log('Messages table ready');
  }

  async saveTranscript(sessionId, messages, title = null) {
    
    if (!this.pool) {
      console.error('Database pool not initialized!');
      throw new Error('Database not initialized');
    }

    try {
      const [existingTranscripts] = await this.pool.execute(
        'SELECT id FROM transcripts WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
        [sessionId]
      );
      
      let transcriptId;
      if (existingTranscripts.length > 0) {
        transcriptId = existingTranscripts[0].id;
        
        if (title) {
          await this.pool.execute(
            'UPDATE transcripts SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [title, transcriptId]
          );
        }
        
        await this.pool.execute('DELETE FROM messages WHERE transcript_id = ?', [transcriptId]);
      } else {
        transcriptId = require('crypto').randomUUID();
        
        const insertTranscript = `
          INSERT INTO transcripts (id, session_id, title) 
          VALUES (?, ?, ?)
        `;
        
        const finalTitle = title || `Chat Session ${new Date().toISOString().split('T')[0]}`;
        
        await this.pool.execute(insertTranscript, [
          transcriptId,
          sessionId,
          finalTitle
        ]);
      }

      if (messages && messages.length > 0) {
        const insertMessage = `
          INSERT INTO messages (transcript_id, role, content, metadata) 
          VALUES (?, ?, ?, ?)
        `;
      
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const metadata = {
            sources: message.sources || [],
            timestamp: message.timestamp || new Date().toISOString()
          };
       
          await this.pool.execute(insertMessage, [
            transcriptId,
            message.role,
            message.content,
            JSON.stringify(metadata)
          ]);
        }
      }

      console.log(`Transcript saved successfully`);
      return transcriptId;
    } catch (error) {
      console.error('Failed to save transcript:', error.message);
      throw error;
    }
  }

  async getTranscript(transcriptId) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    try {
      const [transcriptRows] = await this.pool.execute(
        'SELECT * FROM transcripts WHERE id = ?',
        [transcriptId]
      );

      if (transcriptRows.length === 0) {
        return null;
      }

      const transcript = transcriptRows[0];

      const [messageRows] = await this.pool.execute(
        'SELECT * FROM messages WHERE transcript_id = ? ORDER BY timestamp ASC',
        [transcriptId]
      );

      const messages = messageRows.map(row => ({
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      return {
        id: transcript.id,
        sessionId: transcript.session_id,
        title: transcript.title,
        createdAt: transcript.created_at,
        updatedAt: transcript.updated_at,
        messages
      };
    } catch (error) {
      console.error('Failed to get transcript:', error.message);
      throw error;
    }
  }

  async getTranscriptsBySession(sessionId, limit = 10) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    try {
      const validLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
      
      const [rows] = await this.pool.execute(
        `SELECT * FROM transcripts WHERE session_id = ? ORDER BY created_at DESC LIMIT ${validLimit}`,
        [sessionId]
      );

      return rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Failed to get transcripts by session:', error.message);
      throw error;
    }
  }

  async getAllTranscripts(limit = 50, offset = 0) {
    
    if (!this.pool) {
      console.error('Database pool not initialized in getAllTranscripts!');
      throw new Error('Database not initialized');
    }

    try {
      const validLimit = Math.max(1, Math.min(1000, parseInt(limit) || 50));
      const validOffset = Math.max(0, parseInt(offset) || 0);
      
      const sql = `SELECT * FROM transcripts ORDER BY created_at DESC LIMIT ${validLimit} OFFSET ${validOffset}`;
      const [rows] = await this.pool.execute(sql);
      
      return rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Failed to get all transcripts:', error.message);
      throw error;
    }
  }

  async deleteTranscript(transcriptId) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    try {
      const [result] = await this.pool.execute(
        'DELETE FROM transcripts WHERE id = ?',
        [transcriptId]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Failed to delete transcript:', error.message);
      throw error;
    }
  }

  async searchTranscripts(query, limit = 20) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    try {
      const validLimit = Math.max(1, Math.min(100, parseInt(limit) || 20));
      
      const [rows] = await this.pool.execute(`
        SELECT DISTINCT t.* FROM transcripts t
        JOIN messages m ON t.id = m.transcript_id
        WHERE t.title LIKE ? OR m.content LIKE ?
        ORDER BY t.created_at DESC
        LIMIT ${validLimit}
      `, [`%${query}%`, `%${query}%`]);

      return rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Failed to search transcripts:', error.message);
      throw error;
    }
  }

  async getStats() {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    try {
      const [transcriptCount] = await this.pool.execute(
        'SELECT COUNT(*) as count FROM transcripts'
      );
      
      const [messageCount] = await this.pool.execute(
        'SELECT COUNT(*) as count FROM messages'
      );

      const [recentActivity] = await this.pool.execute(`
        SELECT DATE(created_at) as date, COUNT(*) as count 
        FROM transcripts 
        WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return {
        totalTranscripts: transcriptCount[0].count,
        totalMessages: messageCount[0].count,
        recentActivity: recentActivity
      };
    } catch (error) {
      console.error('Failed to get transcript stats:', error.message);
      throw error;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('Transcript database connection closed');
    }
  }
}

module.exports = { TranscriptService };