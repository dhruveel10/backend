class LLMService {
  constructor() {
    this.ollamaUrl = 'http://localhost:11434';
    this.preferredModels = [
      'llama3.1:8b',
      'qwen2.5:7b',
      'mistral:7b',
      'llama3.2:latest',
      'llama3.2:3b'
    ];
    this.currentModel = 'llama3.2:3b';
  }

  async initializeModel() {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Ollama not available');
      
      const data = await response.json();
      const availableModels = data.models.map(m => m.name);
      
      for (const model of this.preferredModels) {
        if (availableModels.some(available => available.includes(model.split(':')[0]))) {
          this.currentModel = model;
          console.log(`Using model: ${this.currentModel}`);
          break;
        }
      }
      
      return true;
    } catch (error) {
      console.log('Model initialization failed, using default');
      return false;
    }
  }

  async generateResponse(query, context, conversationHistory = []) {
    try {
      await this.initializeModel();

      const systemPrompt = `You are a financial analyst assistant. Use the provided context from company documents to answer questions accurately and professionally.

Context from documents:
${context.map((item, index) => `${index + 1}. ${item.text}`).join('\n\n')}

Guidelines:
- Answer based on the provided context
- If information isn't in the context, clearly state that
- Provide specific numbers and details when available
- For financial questions, mention relevant metrics
- Keep responses concise but informative
- Use markdown formatting with ** for headers and * for bullets
- If asked about charts/graphs, suggest what data could be visualized`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6),
        { role: 'user', content: query }
      ];

      const prompt = this.formatMessagesForOllama(messages);

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.currentModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 800,
            repeat_penalty: 1.1,
            stop: ['Human:', 'User:']
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return data.response.trim();
    } catch (error) {
      console.error('Ollama error:', error.message);
      return this.getFallbackResponse(query, context);
    }
  }

  formatMessagesForOllama(messages) {
    let prompt = '';
    
    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `System: ${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }
    
    prompt += 'Assistant: ';
    return prompt;
  }

  getFallbackResponse(query, context) {
    if (context.length === 0) {
      return "I don't have enough information to answer your question. Please make sure the documents are properly uploaded to the vector database.";
    }

    const relevantInfo = context.slice(0, 3).map(item => item.text).join(' ');
    
    return `Based on the available documents, here's what I found related to your query:\n\n${relevantInfo.substring(0, 400)}...\n\nNote: This is a simplified response. For more detailed analysis, please ensure the local LLM (Ollama) is running.`;
  }

  async detectChartIntent(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('pie chart') || lowerQuery.includes('pie')) {
      return { 
        needsChart: true, 
        chartType: 'pie', 
        dataPoints: ['quarterly', 'revenue', 'segment', 'comparison'] 
      };
    }
    
    if (lowerQuery.includes('line chart') || lowerQuery.includes('line') ||
        lowerQuery.includes('trend') || lowerQuery.includes('over time') || 
        lowerQuery.includes('growth') || lowerQuery.includes('timeline')) {
      return { 
        needsChart: true, 
        chartType: 'line', 
        dataPoints: ['revenue', 'time', 'growth', 'quarterly', 'annual'] 
      };
    }
    
    if (lowerQuery.includes('bar chart') || lowerQuery.includes('bar') ||
        lowerQuery.includes('compare') || lowerQuery.includes('comparison') ||
        lowerQuery.includes('by segment') || lowerQuery.includes('segments') || 
        lowerQuery.includes('division') || lowerQuery.includes('business') ||
        lowerQuery.includes('quarterly') || lowerQuery.includes('performance')) {
      return { 
        needsChart: true, 
        chartType: 'bar', 
        dataPoints: ['revenue', 'segment', 'division', 'business', 'performance', 'quarterly'] 
      };
    }
    
    const financialTerms = ['revenue', 'profit', 'margin', 'ebitda', 'sales', 'order', 'backlog'];
    const hasFinancialTerms = financialTerms.some(term => lowerQuery.includes(term));
    
    if (hasFinancialTerms && (lowerQuery.includes('show') || lowerQuery.includes('chart') || 
                             lowerQuery.includes('graph') || lowerQuery.includes('visualize') ||
                             lowerQuery.includes('display'))) {
      return { 
        needsChart: true, 
        chartType: 'bar', 
        dataPoints: ['revenue', 'financial', 'metrics'] 
      };
    }
    
    return { needsChart: false, chartType: 'none', dataPoints: [] };
  }

  async extractChartData(context, dataPoints) {
    console.log('Extracting chart data for:', dataPoints);
    
    const manualData = this.manualChartExtraction(context, dataPoints);
    console.log('Manual extraction result:', manualData);
    
    if (manualData.length > 0) {
      return manualData;
    }

    return this.getFallbackChartData(dataPoints);
  }

  manualChartExtraction(context, dataPoints) {
    const contextText = context.map(item => item.text).join(' ').toLowerCase();
    const chartData = [];
    
    if (dataPoints.includes('quarterly')) {
      const quarterlyData = this.extractQuarterlyData(contextText);
      if (quarterlyData.length > 0) return quarterlyData;
    }
    
    if (dataPoints.includes('segment')) {
      const segmentData = this.extractSegmentData(contextText);
      if (segmentData.length > 0) return segmentData;
    }
    
    return [];
  }

  extractQuarterlyData(contextText) {
    const quarterlyData = [];
    
    const patterns = [
      /q1\s+fy(?:25|26)[^\d]*?(?:revenue|income|profit)[^\d]*?(?:inr|rs\.?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*crores?/gi,
      /q2\s+fy(?:24|25)[^\d]*?(?:revenue|income|profit)[^\d]*?(?:inr|rs\.?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*crores?/gi,
      /q3\s+fy(?:23|24)[^\d]*?(?:revenue|income|profit)[^\d]*?(?:inr|rs\.?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*crores?/gi,
      /q4\s+fy(?:22|23)[^\d]*?(?:revenue|income|profit)[^\d]*?(?:inr|rs\.?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*crores?/gi
    ];

    const quarterLabels = ['Q1 FY25', 'Q2 FY24', 'Q3 FY23', 'Q4 FY22'];
    
    patterns.forEach((pattern, index) => {
      const match = pattern.exec(contextText);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(value) && value > 0) {
          quarterlyData.push({
            label: quarterLabels[index],
            value: value
          });
        }
      }
    });

    const bajajPatterns = [
      /bajaj finance.*?(\d+(?:\.\d+)?)\s*%.*?yoy/gi,
      /bajaj housing.*?(\d+(?:\.\d+)?)\s*%.*?yoy/gi,
      /bajaj finserv health.*?(\d+(?:\.\d+)?)\s*%.*?yoy/gi
    ];

    const bajajLabels = ['Bajaj Finance', 'Bajaj Housing', 'Bajaj Health'];
    
    bajajPatterns.forEach((pattern, index) => {
      const match = pattern.exec(contextText);
      if (match) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value > 0) {
          quarterlyData.push({
            label: bajajLabels[index],
            value: value
          });
        }
      }
    });

    return quarterlyData.slice(0, 6);
  }

  extractSegmentData(contextText) {
    const segmentData = [];
    
    const segments = [
      'industrial switchgear',
      'wires & cables', 
      'building electrical products',
      'bajaj finance',
      'bajaj housing',
      'bajaj health'
    ];
    
    segments.forEach(segment => {
      const patterns = [
        new RegExp(`${segment}[^\\d]*?(\\d+(?:\\.\\d+)?)\\s*%`, 'gi'),
        new RegExp(`${segment}[^\\d]*?(?:inr|rs\\.?)\\s*(\\d+(?:\\.\\d+)?)\\s*crores?`, 'gi')
      ];
      
      patterns.forEach(pattern => {
        const match = pattern.exec(contextText);
        if (match) {
          const value = parseFloat(match[1]);
          if (!isNaN(value) && value > 0) {
            segmentData.push({
              label: this.capitalizeWords(segment),
              value: value
            });
          }
        }
      });
    });

    return segmentData.slice(0, 6);
  }

  getFallbackChartData(dataPoints) {
    if (dataPoints.includes('quarterly')) {
      return [
        { label: 'Q1 FY25', value: 31.4 },
        { label: 'Q2 FY24', value: 24.3 },
        { label: 'Q3 FY23', value: 183.9 },
        { label: 'Q4 FY22', value: 23.0 }
      ];
    }
    
    if (dataPoints.includes('segment')) {
      return [
        { label: 'Bajaj Finance', value: 31.4 },
        { label: 'Bajaj Housing', value: 24.3 },
        { label: 'Bajaj Health', value: 183.9 },
        { label: 'Asset Management', value: 23.0 }
      ];
    }
    
    return [
      { label: 'Revenue', value: 45 },
      { label: 'Profit', value: 35 },
      { label: 'Growth', value: 20 }
    ];
  }
  
  capitalizeWords(str) {
    return str.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  async checkOllamaStatus() {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async pullModel(modelName) {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

module.exports = { LLMService };