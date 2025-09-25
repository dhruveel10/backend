const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

class SessionService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  async init() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        retry_unfulfilled_commands: true,
        retry_delay_on_failure_ms: 100
      });

      this.client.on('error', (err) => {
        console.warn('Redis Client Error:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis connected successfully');
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (error) {
      console.warn('Redis connection failed, using in-memory fallback:', error.message);
      this.fallbackStorage = new Map();
      this.isConnected = false;
    }
  }

  generateSessionId() {
    return uuidv4();
  }

  async addMessage(sessionId, message, isUser = true) {
    const messageData = {
      id: uuidv4(),
      text: message.text || message,
      isUser,
      timestamp: new Date().toISOString(),
      sources: message.sources || [],
    };
    
    try {
      if (this.isConnected && this.client) {
        const sessionKey = `session:${sessionId}`;
        await this.client.lPush(sessionKey, JSON.stringify(messageData));
        await this.client.expire(sessionKey, 3600 * 24);
        return messageData;
      } else {
        if (!this.fallbackStorage.has(sessionId)) {
          this.fallbackStorage.set(sessionId, []);
        }
        this.fallbackStorage.get(sessionId).unshift(messageData);
        return messageData;
      }
    } catch (error) {
      console.error('Failed to add message:', error);
      if (!this.fallbackStorage.has(sessionId)) {
        this.fallbackStorage.set(sessionId, []);
      }
      this.fallbackStorage.get(sessionId).unshift(messageData);
      return messageData;
    }
  }

  async getSessionHistory(sessionId, limit = 50) {
    
    try {
      if (this.isConnected && this.client) {
        const sessionKey = `session:${sessionId}`;
        const messages = await this.client.lRange(sessionKey, 0, limit - 1);
        const parsed = messages.map(msg => JSON.parse(msg)).reverse();
        return parsed;
      } else {
        const messages = this.fallbackStorage.get(sessionId) || [];
        return messages.slice(0, limit).reverse();
      }
    } catch (error) {
      console.error('Failed to get session history:', error);
      return this.fallbackStorage.get(sessionId) || [];
    }
  }

  async restoreSessionFromStorage(sessionId, sessionStorageService, limit = 50) {
    try {
      console.log(`Attempting to restore session ${sessionId} from MySQL`);
      
      const mysqlHistory = await sessionStorageService.getSessionHistory(sessionId, limit);
      if (!mysqlHistory || mysqlHistory.length === 0) {
        console.log(`No MySQL data found for session ${sessionId}`);
        return { restored: false, messages: [] };
      }

      console.log(`Found ${mysqlHistory.length} messages in MySQL for session ${sessionId}`);

      const redisMessages = mysqlHistory.reverse().map(msg => ({
        id: require('uuid').v4(),
        text: msg.message,
        isUser: msg.role === 'user',
        timestamp: msg.timestamp,
        sources: []
      }));

      if (this.isConnected && this.client) {
        const sessionKey = `session:${sessionId}`;
        
        await this.client.del(sessionKey);
        
        for (const message of redisMessages) {
          await this.client.lPush(sessionKey, JSON.stringify(message));
        }
        
        await this.client.expire(sessionKey, 3600 * 24);
        
        if (redisMessages.length > 0) {
          const title = this.generateTitleFromMessage({ text: redisMessages[0].text });
          await this.setSessionTitle(sessionId, title);
        }
        
        console.log(`Successfully restored ${redisMessages.length} messages to Redis for session ${sessionId}`);
      } else {
        if (!this.fallbackStorage.has(sessionId)) {
          this.fallbackStorage.set(sessionId, []);
        }
        this.fallbackStorage.set(sessionId, redisMessages);
        
        console.log(`Successfully restored ${redisMessages.length} messages to fallback storage for session ${sessionId}`);
      }

      return { 
        restored: true, 
        messages: redisMessages.reverse(),
        restoredCount: redisMessages.length
      };
    } catch (error) {
      console.error(`Failed to restore session ${sessionId}:`, error);
      return { restored: false, messages: [], error: error.message };
    }
  }

  async sessionExists(sessionId) {
    try {
      if (this.isConnected && this.client) {
        const sessionKey = `session:${sessionId}`;
        const exists = await this.client.exists(sessionKey);
        return exists === 1;
      } else {
        return this.fallbackStorage.has(sessionId);
      }
    } catch (error) {
      console.error('Failed to check session existence:', error);
      return this.fallbackStorage.has(sessionId);
    }
  }

  async clearSession(sessionId) {
    try {
      if (this.isConnected && this.client) {
        const sessionKey = `session:${sessionId}`;
        await this.client.del(sessionKey);
        return { success: true, message: 'Session cleared' };
      } else {
        this.fallbackStorage.delete(sessionId);
        return { success: true, message: 'Session cleared (fallback)' };
      }
    } catch (error) {
      console.error('Failed to clear session:', error);
      this.fallbackStorage.delete(sessionId);
      return { success: false, message: 'Failed to clear session' };
    }
  }

  async setSessionTitle(sessionId, title) {
    try {
      if (this.isConnected && this.client) {
        const titleKey = `session_title:${sessionId}`;
        await this.client.set(titleKey, title, { EX: 3600 * 24 });
      } else {
        if (!this.fallbackTitles) {
          this.fallbackTitles = new Map();
        }
        this.fallbackTitles.set(sessionId, title);
      }
    } catch (error) {
      console.error('Failed to set session title:', error);
    }
  }

  async getSessionTitle(sessionId) {
    try {
      if (this.isConnected && this.client) {
        const titleKey = `session_title:${sessionId}`;
        const title = await this.client.get(titleKey);
        return title || this.generateTitleFromId(sessionId);
      } else {
        if (!this.fallbackTitles) {
          this.fallbackTitles = new Map();
        }
        return this.fallbackTitles.get(sessionId) || this.generateTitleFromId(sessionId);
      }
    } catch (error) {
      return this.generateTitleFromId(sessionId);
    }
  }

  generateTitleFromId(sessionId) {
    return `Chat ${sessionId.substring(5, 12)}`;
  }

  generateTitleFromMessage(message) {
    if (!message) return 'New Chat';
    
    const text = message.text || message;
    if (typeof text !== 'string') return 'New Chat';
    
    let title = text.trim();
    
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    
    title = title.replace(/[^\w\s.,!?-]/g, '');
    
    if (title.length < 3) {
      return 'New Chat';
    }
    
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  async getAllSessions() {
    console.log('getAllSessions called, isConnected:', this.isConnected);
    try {
      if (this.isConnected && this.client) {
        const keys = await this.client.keys('session:*');
        const sessions = [];
        for (const key of keys) {
          const sessionId = key.replace('session:', '');
          const messageCount = await this.client.lLen(key);
          const ttl = await this.client.ttl(key);
          const title = await this.getSessionTitle(sessionId);
          
          // Get the last message timestamp
          let lastActivity = null;
          try {
            const lastMessages = await this.client.lRange(key, 0, 0);
            if (lastMessages.length > 0) {
              const lastMessage = JSON.parse(lastMessages[0]);
              lastActivity = lastMessage.timestamp;
            }
          } catch (timestampError) {
            console.warn('Failed to get last message timestamp:', timestampError);
          }
          
          sessions.push({
            sessionId,
            title,
            messageCount,
            expiresIn: ttl > 0 ? ttl : -1,
            lastActivity
          });
        }
        console.log('Returning Redis sessions:', sessions.length);
        return sessions;
      } else {
        const sessions = [];
        for (const sessionId of this.fallbackStorage.keys()) {
          const messages = this.fallbackStorage.get(sessionId) || [];
          const lastActivity = messages.length > 0 ? messages[0].timestamp : null;
          const title = await this.getSessionTitle(sessionId);
          sessions.push({
            sessionId,
            title,
            messageCount: messages.length,
            expiresIn: -1,
            lastActivity
          });
        }
        console.log('Returning fallback sessions:', sessions.length);
        return sessions;
      }
    } catch (error) {
      console.error('Failed to get sessions:', error);
      return [];
    }
  }

  async getStats() {
    try {
      if (this.isConnected && this.client) {
        const info = await this.client.info('memory');
        const keys = await this.client.keys('session:*');
        return {
          connected: true,
          activeSessions: keys.length,
          memoryInfo: info.split('\n').find(line => line.includes('used_memory_human'))?.split(':')[1]?.trim() || 'N/A'
        };
      } else {
        return {
          connected: false,
          activeSessions: this.fallbackStorage.size,
          memoryInfo: 'In-memory fallback'
        };
      }
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        activeSessions: this.fallbackStorage?.size || 0
      };
    }
  }


  async cleanupEmptySessions() {
    const results = { cleaned: 0, errors: [] };

    try {
      const sessions = await this.getAllSessions();

      for (const session of sessions) {
        try {
          if (session.messageCount === 0) {
            const clearResult = await this.clearSession(session.sessionId);
            if (clearResult.success) {
              results.cleaned++;
              console.log(`Cleaned empty session: ${session.sessionId}`);
            } else {
              results.errors.push(`${session.sessionId}: Failed to clear`);
            }
          }
        } catch (error) {
          results.errors.push(`${session.sessionId}: ${error.message}`);
        }
      }
    } catch (error) {
      results.errors.push(`Failed to get sessions: ${error.message}`);
    }

    return results;
  }

  async close() {
    try {
      if (this.client && this.isConnected) {
        await this.client.quit();
      }
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

module.exports = { SessionService };