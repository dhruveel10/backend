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
      chart: message.chart || null
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
        return messages.map(msg => JSON.parse(msg)).reverse();
      } else {
        const messages = this.fallbackStorage.get(sessionId) || [];
        return messages.slice(0, limit).reverse();
      }
    } catch (error) {
      console.error('Failed to get session history:', error);
      return this.fallbackStorage.get(sessionId) || [];
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
    try {
      if (this.isConnected && this.client) {
        const keys = await this.client.keys('session:*');
        const sessions = [];
        for (const key of keys) {
          const sessionId = key.replace('session:', '');
          const messageCount = await this.client.lLen(key);
          const ttl = await this.client.ttl(key);
          const title = await this.getSessionTitle(sessionId);
          sessions.push({
            sessionId,
            title,
            messageCount,
            expiresIn: ttl > 0 ? ttl : -1
          });
        }
        return sessions;
      } else {
        return Array.from(this.fallbackStorage.keys()).map(sessionId => ({
          sessionId,
          title: this.getSessionTitle(sessionId),
          messageCount: this.fallbackStorage.get(sessionId).length,
          expiresIn: -1
        }));
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