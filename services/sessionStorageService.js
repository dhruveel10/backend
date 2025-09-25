const mysql = require('mysql2/promise');

class SessionStorageService {
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
      console.log('Session storage database connected');
      
      await this.createTable();
    } catch (error) {
      console.error('Failed to initialize session storage database:', error.message);
    }
  }

  async createTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        role ENUM('user', 'bot') NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session_id (session_id),
        INDEX idx_timestamp (timestamp)
      )
    `;

    try {
      await this.pool.execute(createTableSQL);
      console.log('Chat messages table ready');
    } catch (error) {
      console.error('Failed to create chat_messages table:', error);
    }
  }

  async saveMessage(sessionId, message, role) {
    if (!this.pool) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const sql = 'INSERT INTO chat_messages (session_id, message, role) VALUES (?, ?, ?)';
      await this.pool.execute(sql, [sessionId, message, role]);
      return true;
    } catch (error) {
      console.error('Failed to save message:', error);
      return false;
    }
  }

  async getSessionHistory(sessionId, limit = 50) {
    if (!this.pool) {
      console.error('Database not initialized');
      return [];
    }

    try {
      const parsedLimit = parseInt(limit) || 50;
      console.log('getSessionHistory params:', { sessionId, limit, parsedLimit });
      const sql = `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ${parsedLimit}`;
      const [rows] = await this.pool.query(sql, [sessionId]);
      
      return rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        message: row.message,
        role: row.role,
        timestamp: row.timestamp
      }));
    } catch (error) {
      console.error('Failed to get session history:', error);
      return [];
    }
  }

  async getAllSessions(limit = 100) {
    if (!this.pool) {
      console.error('Database not initialized');
      return [];
    }

    try {
      const parsedLimit = parseInt(limit) || 100;
      console.log('getAllSessions params:', { limit, parsedLimit });
      const sql = `
        SELECT 
          session_id,
          COUNT(*) as message_count,
          MAX(timestamp) as last_activity,
          MIN(timestamp) as first_activity
        FROM chat_messages 
        GROUP BY session_id 
        ORDER BY last_activity DESC 
        LIMIT ${parsedLimit}
      `;
      const [rows] = await this.pool.query(sql);
      
      return rows.map(row => ({
        sessionId: row.session_id,
        messageCount: row.message_count,
        lastActivity: row.last_activity,
        firstActivity: row.first_activity
      }));
    } catch (error) {
      console.error('Failed to get all sessions:', error);
      return [];
    }
  }

  async deleteSession(sessionId) {
    if (!this.pool) {
      console.error('Database not initialized');
      return false;
    }

    try {
      const sql = 'DELETE FROM chat_messages WHERE session_id = ?';
      const [result] = await this.pool.execute(sql, [sessionId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }

  async getStats() {
    if (!this.pool) {
      return { totalMessages: 0, totalSessions: 0 };
    }

    try {
      const [messageCount] = await this.pool.execute('SELECT COUNT(*) as count FROM chat_messages');
      const [sessionCount] = await this.pool.execute('SELECT COUNT(DISTINCT session_id) as count FROM chat_messages');
      
      return {
        totalMessages: messageCount[0].count,
        totalSessions: sessionCount[0].count
      };
    } catch (error) {
      console.error('Failed to get stats:', error);
      return { totalMessages: 0, totalSessions: 0 };
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('Session storage database connection closed');
    }
  }
}

module.exports = { SessionStorageService };