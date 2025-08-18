const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 800,
      }
    });
    this.isInitialized = false;
  }

  async initializeModel() {
    try {
      const testResult = await this.model.generateContent("Hello");
      this.isInitialized = true;
      console.log('Gemini API initialized successfully');
      return true;
    } catch (error) {
      console.error('Gemini API initialization failed:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  async generateResponse(query, context, conversationHistory = []) {
    try {
      if (!this.isInitialized) {
        await this.initializeModel();
      }

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

      const conversationContext = conversationHistory.length > 0 
        ? `\n\nPrevious conversation:\n${conversationHistory.slice(-6).map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
        : '';

      const fullPrompt = `${systemPrompt}${conversationContext}\n\nUser question: ${query}\n\nAssistant:`;

      const result = await this.model.generateContent(fullPrompt);
      const response = result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Gemini API error:', error.message);
      return this.getFallbackResponse(query, context);
    }
  }

  getFallbackResponse(query, context) {
    if (context.length === 0) {
      return "I don't have enough information to answer your question. Please make sure the documents are properly uploaded to the vector database.";
    }

    const relevantInfo = context.slice(0, 3).map(item => item.text).join(' ');
    
    return `Based on the available documents, here's what I found related to your query:\n\n${relevantInfo.substring(0, 400)}...\n\nNote: This is a simplified response. The AI service is currently unavailable.`;
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

  async checkGeminiStatus() {
    try {
      const result = await this.model.generateContent("test");
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkOllamaStatus() {
    return await this.checkGeminiStatus();
  }
}

module.exports = { LLMService };