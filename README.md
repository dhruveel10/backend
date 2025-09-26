# Backend - RAG-Powered News Chatbot API

A robust Node.js backend service implementing a Retrieval-Augmented Generation (RAG) pipeline for answering queries over a news corpus. Built with Express.js, featuring real-time chat capabilities, intelligent session management, and vector-based semantic search.

## Live API

The backend is running locally and exposed via **ngrok** to enable communication with the Vercel-hosted frontend. This setup allows for seamless integration between the cloud-hosted frontend and local development environment.

## Architecture Overview

### RAG Pipeline Implementation
1. **News Ingestion**: ~50 news articles processed and chunked (5-10 chunks per article)
2. **Embeddings**: Generated using Jina Embeddings API
3. **Vector Storage**: Pinecone vector database for semantic search
4. **Retrieval**: Top-k (k=10) passages retrieved for each query
5. **Generation**: Google Gemini API for final answer synthesis

### Data Flow
```
User Query → Embedding → Vector Search (Pinecone) → Context Retrieval → Gemini API → Response
```

## Key Features

### 🔍 RAG Implementation
- **Semantic Search**: Jina embeddings for high-quality vector representations
- **Pinecone Integration**: Scalable vector database with fast similarity search
- **Context Retrieval**: Top-10 most relevant passages for each query
- **Answer Generation**: Google Gemini API for contextual responses

### Real-Time Communication
- **Socket.IO Integration**: Real-time bidirectional communication
- **Character-by-character streaming**: Frontend displays responses as they're generated
- **Connection monitoring**: Automatic server status detection
- **Fallback handling**: Graceful degradation when server is down

### Dual Storage Strategy
- **Redis**: In-memory session management with 24-hour TTL
- **MySQL**: Persistent storage for inactive sessions and chat history
- **Automatic migration**: Sessions move from Redis to MySQL after expiration

### Session Management
- **24-hour TTL**: Active sessions in Redis with automatic expiration
- **Session persistence**: Inactive sessions stored in MySQL
- **Reactivation**: Seamless restoration of inactive sessions to active state
- **Unique identifiers**: Each user gets a new session with UUID

## Tech Stack

- **Framework**: Node.js with Express.js
- **Real-time**: Socket.IO for bidirectional communication
- **Embeddings**: Jina Embeddings API
- **Vector Database**: Pinecone
- **LLM**: Google Gemini API
- **Cache**: Redis (in-memory sessions)
- **Database**: MySQL (persistent storage)
- **Deployment**: Local with ngrok tunnel

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- Redis server running locally
- MySQL server running locally
- Pinecone account and API key
- Google AI Studio API key
- Jina AI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/dhruveel10/backend.git
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   
   Create a `.env` file in the root directory:
   ```env
   # Server Configuration
   PORT=3005
   FRONTEND_URL=http://localhost:3000
   
   # API Keys
   PINECONE_API_KEY=your_pinecone_api_key
   OPENAI_API_KEY=your_openai_api_key
   GEMINI_API_KEY=your_gemini_api_key
   JINA_API_KEY=your_jina_api_key
   
   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   
   # MySQL Configuration
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=news_ai_chatbot
   ```

4. **Database Setup**
   
   Ensure MySQL is running and create the database:
   ```sql
   CREATE DATABASE news_ai_chatbot;
   ```
   
   The application will automatically create necessary tables on startup.

5. **Start Redis Server**
   ```bash
   redis-server
   ```

6. **Run the application**
   ```bash
   npm start
   ```

## API Endpoints

### REST Endpoints
- `GET /api/sessions/:sessionId/history` - Retrieve session chat history
- `DELETE /api/sessions/:sessionId` - Clear/reset session
- `POST /api/chat` - Send chat message (alternative to Socket.IO)
- `GET /api/health` - Health check endpoint
- `GET /api/stats` - System statistics
- `GET /api/sessions` - List all active and inactive sessions
- `GET /api/sessions/:sessionId/exists` - Check if session exists in Redis or MySQL
- `GET /api/sessions/stored` - Get all stored sessions from MySQL
- `GET /api/sessions/:sessionId/stored-history` - Get session history from MySQL
- `GET /api/sessions/status` - Detailed session status across Redis and MySQL
- `POST /api/sessions/cleanup` - Trigger manual cleanup of empty sessions
- `DELETE /api/sessions/:sessionId/redis` - Delete session from Redis only

### Socket.IO Events
- `connection` - Client connection established
- `join-session` - Join specific session room
- `send-message` - Send chat message
- `receive-message` - Receive bot response
- `typing` - Typing indicators
- `error` - Error handling

## Caching & Performance Strategy

### Redis Configuration & TTL Management

#### Session TTL Configuration
```javascript
const SESSION_TTL = 3600 * 24; // 24 hours in seconds

await redis.expire(`session:${sessionId}`, SESSION_TTL);
```

#### Session Lifecycle Management
```javascript
// Active sessions in Redis with 24-hour TTL
await redis.lPush(sessionKey, JSON.stringify(messageData));
await redis.expire(sessionKey, 3600 * 24);

// Restoration from MySQL when session expires
const restoreResult = await sessionService.restoreSessionFromStorage(
  sessionId, 
  sessionStorageService, 
  limit
);
```

### Performance Optimizations

#### Vector Search Caching
- **Embedding Cache**: Frequently queried embeddings cached for performance
- **Search Results**: Top-k results optimized through Pinecone
- **Context Caching**: Retrieved contexts processed efficiently

#### Database Connection Pooling
```javascript
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  queueLimit: 0
});
```

## Session Lifecycle Management

### Active Session Flow
1. **Creation**: New session created with UUID in Redis
2. **Activity**: Chat messages stored in Redis with 24-hour TTL
3. **Real-time Updates**: Socket.IO enables instant message delivery
4. **TTL Refresh**: Session activity resets TTL to 24 hours

### Session Migration Flow
1. **TTL Expiration**: Sessions expire after 24 hours in Redis
2. **MySQL Storage**: All messages automatically stored in MySQL during active session
3. **Inactive State**: After Redis expiration, chats remain accessible in MySQL
4. **Reactivation**: When users access inactive sessions, they automatically move back to Redis as new entries
5. **Seamless Restoration**: Users can continue conversations without data loss

## Real-Time Features

### Socket.IO Implementation
```javascript
io.on('connection', (socket) => {
  socket.on('send-message', async (data) => {
    const response = await chatService.processMessage(message, sessionId);
    
    // Stream response word by word
    const words = response.response.split(' ');
    for (let i = 0; i < words.length; i++) {
      socket.emit('message-stream', {
        text: currentText,
        isComplete: i === words.length - 1,
        sessionId: currentSessionId
      });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });
});
```

### Connection Monitoring
- **Server Status**: Frontend automatically detects server availability
- **Reconnection Logic**: Automatic reconnection on connection loss
- **Fallback Mode**: REST API fallback when Socket.IO unavailable

## Database Schema

### Redis Schema
```
session:{sessionId} -> List<{
  id: string,
  text: string,
  isUser: boolean,
  timestamp: string,
  sources: array
}>

session_title:{sessionId} -> string (24h TTL)
```

### MySQL Schema
```sql
CREATE TABLE chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  role ENUM('user', 'bot') NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_timestamp (timestamp)
);
```

## Deployment Architecture

### Local Development with ngrok
- **Backend**: Runs locally on port 3005
- **ngrok Tunnel**: Exposes local server to internet
- **Frontend**: Deployed on Vercel, connects via ngrok URL
- **Databases**: Local Redis and MySQL instances

### Production Considerations
For production deployment:
- Deploy backend to cloud service (Render, Railway, etc.)
- Use managed Redis (Redis Cloud, AWS ElastiCache)
- Use managed MySQL (PlanetScale, AWS RDS)
- Update CORS settings for production domains

## 🔧 Configuration Options

### Cache TTL Configuration
```javascript
const CACHE_CONFIG = {
  SESSION_TTL: 24 * 60 * 60,        // 24 hours
  MAINTENANCE_INTERVAL: 4 * 60 * 60 * 1000  // 4 hours
};
```

### RAG Pipeline Configuration
```javascript
const RAG_CONFIG = {
  TOP_K_RESULTS: 10,                
  JINA_MODEL: 'jina-embeddings-v3',
  GEMINI_MODEL: 'gemini-1.5-flash' 
};
```

## Technical Highlights

### Vector Database Implementation
- Uses Pinecone for scalable vector storage (`news-chatbot-rag` index)
- Implements similarity search with top-10 results
- Supports metadata filtering and source-based queries
- 1024-dimensional Jina embeddings with fallback support

### LLM Integration
- Google Gemini API integration for response generation
- Fallback mechanisms for API failures
- Conversation context management through session history
- Specialized news analysis and question-answering prompts

### Session Management
- Dual-storage architecture (Redis + MySQL)
- Automatic session cleanup and maintenance
- Session restoration capabilities
- UUID-based session identification

## API Documentation

### Chat Message Format
```javascript
// Request
{
  "message": "What's happening in the tech industry?",
  "sessionId": "optional-session-id"
}

// Response
{
  "response": "Based on recent news...",
  "sources": [
    {
      "title": "Article Title",
      "source": "Source Name",
      "url": "https://...",
      "score": 0.85
    }
  ],
  "sessionId": "uuid-session-id"
}
```

### Session History Format
```javascript
{
  "sessionId": "uuid",
  "history": [
    {
      "id": "message-uuid",
      "text": "User or bot message",
      "isUser": true/false,
      "timestamp": "2023-...",
      "sources": []
    }
  ],
  "exists": true,
  "source": "redis|mysql",
  "restored": false
}
```

---
### [Frontend repo](https://github.com/dhruveel10/frontend)

*This backend service is designed to work seamlessly with the React frontend. Ensure both services are running for full functionality.*
