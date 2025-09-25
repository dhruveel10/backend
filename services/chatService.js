const { TranscriptService } = require('./transcriptService');

class ChatService {
  constructor(vectorService, llmService, sessionService = null) {
    this.vectorService = vectorService;
    this.llmService = llmService;
    this.sessions = new Map();
    this.transcriptService = new TranscriptService();
    this.sessionService = sessionService; 
  }

  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        history: [],
        context: []
      });
    }
    return this.sessions.get(sessionId);
  }

  addToHistory(sessionId, role, content) {
    const session = this.getSession(sessionId);
    session.history.push({ role, content });
    
    if (session.history.length > 10) {
      session.history = session.history.slice(-10);
    }
  }

  async processMessage(message, sessionId = 'default') {
    
    try {
      const session = this.getSession(sessionId);
      
      const searchResults = await this.vectorService.searchSimilar(message, 15);
      const filteredResults = this.removeDuplicates(searchResults);
      
      const chartIntent = this.detectChartRequest(message, filteredResults);
      
      const response = await this.llmService.generateResponse(
        message, 
        filteredResults, 
        session.history
      );

      let chartData = null;
      if (chartIntent.needsChart) {
        chartData = this.extractTableBasedChartData(response, message, filteredResults, chartIntent);
        
        if (!chartData || chartData.length < 2) {
          console.log('Chart requested but insufficient data found. No chart will be generated.');
          chartData = null;
        } else {
          console.log('Chart data extracted successfully:', chartData);
        }
      }

      this.addToHistory(sessionId, 'user', message);
      this.addToHistory(sessionId, 'assistant', response);
      
      return {
        response,
        sources: filteredResults.map(r => ({
          source: r.source,
          score: r.score
        })),
        chart: chartData && chartData.length >= 2 ? {
          type: chartIntent.chartType,
          data: chartData,
          title: this.generateChartTitle(message, chartIntent.chartType, chartIntent.company)
        } : null
      };
    } catch (error) {
      console.error('Chat processing error:', error);
      return {
        response: 'I apologize, but I encountered an error processing your request. Please try again.',
        sources: [],
        chart: null
      };
    }
  }

  detectChartRequest(message, context) {
    const lowerMessage = message.toLowerCase();
    
    const chartKeywords = [
      'chart', 'graph', 'visualize', 'plot', 'show me', 'display',
      'quarterly comparison', 'compare', 'comparison', 'vs', 'versus',
      'trend', 'performance', 'breakdown', 'distribution'
    ];
    
    const hasChartKeyword = chartKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (hasChartKeyword) {
      const company = this.extractCompanyFromMessage(message, context);
      
      if (lowerMessage.includes('quarterly') || lowerMessage.includes('quarter') || 
          lowerMessage.includes('q1') || lowerMessage.includes('q2') || 
          lowerMessage.includes('q3') || lowerMessage.includes('q4')) {
        return {
          needsChart: true,
          chartType: 'bar',
          dataPoints: ['quarterly', 'comparison'],
          company: company
        };
      }
      
      return {
        needsChart: true,
        chartType: 'bar',
        dataPoints: ['financial'],
        company: company
      };
    }
    
    return {
      needsChart: false,
      chartType: 'none',
      dataPoints: [],
      company: null
    };
  }

  extractCompanyFromMessage(message, context) {
    const lowerMessage = message.toLowerCase();
    
    if (context && context.length > 0) {
      for (const item of context) {
        if (item.company) {
          const companyWords = item.company.toLowerCase().split(/\s+/);
          for (const word of companyWords) {
            if (word.length > 3 && lowerMessage.includes(word)) {
              return item.company.split(' ')[0];
            }
          }
        }
      }
      
      if (context[0] && context[0].company) {
        return context[0].company.split(' ')[0];
      }
    }
    
    const words = lowerMessage.split(/\s+/);
    const excludeWords = ['chart', 'graph', 'show', 'data', 'quarterly', 'comparison', 'revenue', 'profit', 'financial', 'performance'];
    const potentialCompanies = words.filter(word => 
      word.length > 3 && !excludeWords.includes(word)
    );
    
    return potentialCompanies.length > 0 ? potentialCompanies[0] : null;
  }

  extractTableBasedChartData(response, message, context, chartIntent) {
    console.log('Extracting table-based chart data...');
    
    let tableData = this.extractFinancialTableData(response);
    if (tableData.length >= 2) {
      console.log('Found table data in response:', tableData);
      return tableData;
    }
    
    for (const item of context) {
      if (item.isSpecialContent && item.contentType === 'table') {
        tableData = this.extractFinancialTableData(item.text);
        if (tableData.length >= 2) {
          console.log('Found table data in context:', tableData);
          return tableData;
        }
      }
    }
    
    for (const item of context) {
      if (item.isSpecialContent && item.contentType === 'financial_section') {
        tableData = this.extractFinancialTableData(item.text);
        if (tableData.length >= 2) {
          console.log('Found table data in financial section:', tableData);
          return tableData;
        }
      }
    }
    
    for (const item of context) {
      tableData = this.extractFinancialTableData(item.text);
      if (tableData.length >= 2) {
        console.log('Found table data in context item:', tableData);
        return tableData;
      }
    }
    
    const bulletData = this.extractBulletPointData(response);
    if (bulletData.length >= 2) {
      console.log('Using bullet point data:', bulletData);
      return bulletData;
    }
    
    return [];
  }

  extractFinancialTableData(text) {
    const data = [];
    console.log('Analyzing text for financial table data...');
    
    if (this.isTableStyleTable(text)) {
      const tableData = this.extractTableDataFixed(text);
      if (tableData.length >= 2) {
        return tableData;
      }
    }
    
    const structuredData = this.extractStructuredFinancialData(text);
    if (structuredData.length >= 2) {
      return structuredData;
    }
    
    const quarterlyData = this.extractQuarterlyDataFromText(text);
    if (quarterlyData.length >= 2) {
      return quarterlyData;
    }
    
    return data;
  }

  isTableStyleTable(text) {
    const lowerText = text.toLowerCase();
    return (lowerText.includes('q1') || lowerText.includes('quarter') || lowerText.includes('fy')) && 
           (lowerText.includes('orders') || lowerText.includes('revenue') || lowerText.includes('profit') || 
            lowerText.includes('sales') || lowerText.includes('income') || lowerText.includes('earnings'));
  }

  extractTableDataFixed(text) {
    const data = [];
    const lines = text.split('\n');
    
    console.log('Processing financial table with fixed extraction...');
    
    const commonMetrics = ['Orders', 'Revenue', 'Sales', 'Income', 'Profit', 'EBITDA', 'PBT', 'PAT', 'Earnings'];
    const timePatterns = ['Q1', 'Q2', 'Q3', 'Q4', 'FY', 'Quarter', 'Year'];
    
    let tableStarted = false;
    let headerLine = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (timePatterns.some(pattern => line.includes(pattern)) && 
          line.split(/\s+/).length > 3) {
        headerLine = line;
        tableStarted = true;
        console.log('Found header line:', headerLine);
        continue;
      }
      
      if (tableStarted) {
        for (const metric of commonMetrics) {
          if (line.startsWith(metric)) {
            const rowData = this.parseTableRow(line, metric);
            data.push(...rowData);
            console.log(`Extracted ${metric} data:`, rowData);
            break;
          }
        }
      }
    }
    
    if (data.length < 2) {
      console.log('Trying alternative table parsing...');
      return this.extractTableDataAlternative(text);
    }
    
    console.log('Final extracted table data:', data);
    return data.slice(0, 15);
  }

  parseTableRow(line, metric) {
    const rowData = [];
    
    const parts = line.split(/\s+/);
    const values = [];
    
    for (let i = 1; i < parts.length; i++) {
      const cleanValue = parts[i].replace(/,/g, '').replace(/[^\d.-]/g, '');
      const numValue = parseFloat(cleanValue);
      
      if (!isNaN(numValue) && numValue > 0) {
        values.push(numValue);
      }
    }
    
    values.forEach((value, index) => {
      if (value > 0) {
        rowData.push({
          label: `${metric} Period ${index + 1}`,
          value: value
        });
      }
    });
    
    return rowData;
  }

  extractTableDataAlternative(text) {
    const data = [];
    
    const patterns = [
      /(orders|revenue|sales|income|profit|earnings|ebitda|pbt|pat)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi
    ];
    
    const lowerText = text.toLowerCase();
    
    const metricMatches = [
      { pattern: /(orders)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi, metric: 'Orders' },
      { pattern: /(revenue|sales)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi, metric: 'Revenue' },
      { pattern: /(profit|pat)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi, metric: 'Profit' },
      { pattern: /(income)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi, metric: 'Income' },
      { pattern: /(ebitda)[^\d]*?(\d+(?:,\d+)*(?:\.\d+))/gi, metric: 'EBITDA' }
    ];
    
    metricMatches.forEach(({ pattern, metric }) => {
      let match;
      const values = [];
      
      while ((match = pattern.exec(lowerText)) !== null && values.length < 5) {
        const value = parseFloat(match[2].replace(/,/g, ''));
        if (!isNaN(value) && value > 0) {
          values.push(value);
        }
      }
      
      values.forEach((value, index) => {
        data.push({
          label: `${metric} Period ${index + 1}`,
          value: value
        });
      });
    });
    
    return data;
  }

  extractStructuredFinancialData(text) {
    const data = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.includes('|') && trimmedLine.includes('INR crore')) {
        continue;
      }
      
      if (trimmedLine.includes('|')) {
        const parts = trimmedLine.split('|').map(p => p.trim()).filter(p => p);
        
        if (parts.length >= 3) {
          const metric = parts[0];
          
          for (let i = 1; i < parts.length; i++) {
            const value = parseFloat(parts[i].replace(/,/g, ''));
            if (!isNaN(value) && value > 0) {
              data.push({
                label: `${metric} Col${i}`,
                value: value
              });
            }
          }
        }
      }
    }
    
    return data;
  }

  extractQuarterlyDataFromText(text) {
    const data = [];
    const lowerText = text.toLowerCase();
    
    const patterns = [
      /(orders|revenue|profit|sales|income|earnings|ebitda|pbt|pat)[^\d]*?q[1-4]\s*fy\s*\d+[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /q[1-4]\s*fy\s*\d+[^\d]*?(orders|revenue|profit|sales|income|earnings|ebitda|pbt|pat)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /(orders|revenue|profit|sales|income|earnings|ebitda|pbt|pat)[^\d]*?quarter\s*\d+[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)/gi
    ];
    
    patterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(lowerText)) !== null) {
        const metric = match[1];
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0) {
          const context = match[0];
          let period = 'Period';
          
          if (context.includes('q1')) period = 'Q1';
          else if (context.includes('q2')) period = 'Q2';
          else if (context.includes('q3')) period = 'Q3';
          else if (context.includes('q4')) period = 'Q4';
          
          data.push({
            label: `${this.capitalizeWords(metric)} ${period}`,
            value: value
          });
        }
      }
    });
    
    return data;
  }

  extractBulletPointData(text) {
    const data = [];
    console.log('Extracting bullet point data from:', text.substring(0, 200));
    
    const bulletPatterns = [
      /\*\*•\s*([^:*]+):\s*\*\*\s*(?:rs\.?\s*|₹\s*|\$\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion|k|m|b)/gi,
      /•\s*([^:]+):\s*(?:rs\.?\s*|₹\s*|\$\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion|k|m|b)/gi,
      /\*\*([^:*]+):\s*\*\*\s*(?:rs\.?\s*|₹\s*|\$\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion|k|m|b)/gi,
      /([A-Za-z\s()]+):\s*(?:rs\.?\s*|₹\s*|\$\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion|k|m|b)/gi,
      /([A-Za-z\s()]+)\s+(?:rs\.?\s*|₹\s*|\$\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion|k|m|b)/gi
    ];
    
    bulletPatterns.forEach((pattern, index) => {
      let match;
      pattern.lastIndex = 0;
      
      while ((match = pattern.exec(text)) !== null) {
        let metric = match[1].trim();
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        metric = metric.replace(/\*\*/g, '').replace(/•/g, '').trim();
        
        if (!isNaN(value) && value > 0 && metric.length > 1) {
          const existingItem = data.find(item => 
            item.label.toLowerCase().includes(metric.toLowerCase()) ||
            metric.toLowerCase().includes(item.label.toLowerCase())
          );
          
          if (!existingItem) {
            data.push({
              label: this.capitalizeWords(metric),
              value: value
            });
            console.log(`Pattern ${index + 1} extracted:`, metric, '=', value);
          }
        }
      }
    });
    
    return data.slice(0, 8);
  }

  capitalizeWords(str) {
    return str.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  removeDuplicates(results) {
    const seen = new Set();
    return results.filter(result => {
      const key = result.text.substring(0, 100);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  generateChartTitle(query, chartType, company) {
    const lowerQuery = query.toLowerCase();
    
    let companyName = '';
    if (company) {
      companyName = this.capitalizeWords(company);
    }
    
    if (lowerQuery.includes('quarterly')) {
      return companyName ? `${companyName} Quarterly Financial Comparison` : 'Quarterly Financial Comparison';
    }
    
    return companyName ? `${companyName} Financial Performance` : 'Financial Performance Analysis';
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSessionHistory(sessionId) {
    const session = this.getSession(sessionId);
    return session.history;
  }

  async saveSessionTranscript(sessionId, title = null) {
    
    try {
      let conversationHistory = [];
      
      if (conversationHistory.length === 0) {
        console.log(' No conversation history found for session:', sessionId);
        return null;
      }

      const messages = conversationHistory.map(message => ({
        role: message.isUser ? 'user' : 'assistant',
        content: message.text,
        timestamp: message.timestamp || new Date().toISOString(),
        sources: message.sources || []
      }));
      
      const transcriptId = await this.transcriptService.saveTranscript(sessionId, messages, title);
      console.log(`Transcript saved successfully for session ${sessionId}: ${transcriptId}`);
      
      return transcriptId;
    } catch (error) {
      console.error('Failed to save session transcript:', error.message);
      throw error;
    }
  }

  async getTranscript(transcriptId) {
    try {
      return await this.transcriptService.getTranscript(transcriptId);
    } catch (error) {
      console.error('Failed to get transcript:', error.message);
      throw error;
    }
  }

  async getTranscriptsBySession(sessionId) {
    try {
      return await this.transcriptService.getTranscriptsBySession(sessionId);
    } catch (error) {
      console.error('Failed to get transcripts by session:', error.message);
      throw error;
    }
  }

  async getAllTranscripts(limit = 50, offset = 0) {
    try {
      return await this.transcriptService.getAllTranscripts(limit, offset);
    } catch (error) {
      console.error('Failed to get all transcripts:', error.message);
      throw error;
    }
  }

  async searchTranscripts(query) {
    try {
      return await this.transcriptService.searchTranscripts(query);
    } catch (error) {
      console.error('Failed to search transcripts:', error.message);
      throw error;
    }
  }

  async deleteTranscript(transcriptId) {
    try {
      return await this.transcriptService.deleteTranscript(transcriptId);
    } catch (error) {
      console.error('Failed to delete transcript:', error.message);
      throw error;
    }
  }

  async getTranscriptStats() {
    try {
      return await this.transcriptService.getStats();
    } catch (error) {
      console.error('Failed to get transcript stats:', error.message);
      throw error;
    }
  }
}

module.exports = { ChatService };