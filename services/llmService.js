const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        maxOutputTokens: 1200,
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

      if (context.length === 0) {
        return "I don't have access to any documents in the database. Please ensure documents are properly uploaded and indexed.";
      }

      const contextText = context.map(item => item.text).join('\n\n');
      const sources = [...new Set(context.map(item => item.source))];

      // Enhanced company list detection
      if (this.isCompanyListQuery(query)) {
        return this.generateCompanyList(contextText, sources, context);
      }

      const systemPrompt = `You are a financial analyst with access to financial documents. Answer based only on the provided context.

Context from documents:
${contextText}

Available sources: ${sources.join(', ')}

Guidelines:
- Answer only based on the provided context
- If information is not in the context, say "This information is not available in the provided documents"
- Be specific and cite actual numbers when available
- Extract company names from document content, filenames, and metadata
- For chart requests, be explicit about what data is available
- If asked about companies, thoroughly scan all text for company mentions`;

      const conversationContext = conversationHistory.length > 0 
        ? `\n\nPrevious conversation:\n${conversationHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
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

  isCompanyListQuery(query) {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('list of companies') || 
           lowerQuery.includes('which companies') ||
           lowerQuery.includes('all companies') ||
           lowerQuery.includes('company names') ||
           lowerQuery.includes('browse through') ||
           lowerQuery.includes('find different company');
  }

  generateCompanyList(contextText, sources, fullContext) {
    // Enhanced company extraction from multiple sources
    const companies = this.extractCompanyNamesEnhanced(contextText, sources, fullContext);
    
    if (companies.length === 0) {
      return "I cannot identify specific company names from the available documents. The documents might contain financial data but company names are not clearly extractable from the current context.";
    }

    let response = "**Companies identified in the database:**\n\n";
    companies.forEach((company, index) => {
      response += `${index + 1}. ${company}\n`;
    });

    // Check for quarterly data availability
    const quarterlySources = sources.filter(source => 
      source.toLowerCase().includes('q1') || 
      source.toLowerCase().includes('q2') || 
      source.toLowerCase().includes('q3') || 
      source.toLowerCase().includes('q4') ||
      source.toLowerCase().includes('quarter') ||
      source.toLowerCase().includes('fy2')
    );

    if (quarterlySources.length > 0) {
      response += `\n**Sources with potential quarterly data:** ${quarterlySources.join(', ')}`;
    }

    response += `\n\n**Total companies found:** ${companies.length}`;
    response += `\n**Total sources scanned:** ${sources.length}`;

    return response;
  }

  extractCompanyNamesEnhanced(contextText, sources, fullContext) {
    const companies = new Set();
    const text = contextText.toLowerCase();

    // 1. Extract from filenames/sources (most reliable)
    sources.forEach(source => {
      const companyFromSource = this.extractCompanyFromFilename(source);
      if (companyFromSource) {
        companies.add(companyFromSource);
      }
    });

    // 2. Extract from document metadata if available
    fullContext.forEach(item => {
      if (item.source) {
        const companyFromSource = this.extractCompanyFromFilename(item.source);
        if (companyFromSource) {
          companies.add(companyFromSource);
        }
      }
    });

    // 3. Enhanced pattern matching for Indian companies
    const enhancedCompanyPatterns = [
      // Bajaj Group
      /bajaj\s+finance(?:\s+limited)?/g,
      /bajaj\s+housing(?:\s+finance)?/g,
      /bajaj\s+finserv(?:\s+limited)?/g,
      /bajaj\s+auto(?:\s+limited)?/g,
      /bajaj\s+holdings/g,
      
      // IT Companies
      /infosys(?:\s+limited)?/g,
      /tata\s+consultancy\s+services/g,
      /tcs(?:\s+limited)?/g,
      /wipro(?:\s+limited)?/g,
      /hcl\s+technologies/g,
      /tech\s+mahindra(?:\s+limited)?/g,
      /mindtree(?:\s+limited)?/g,
      /l&t\s+infotech/g,
      
      // Banking & Financial
      /hdfc\s+bank(?:\s+limited)?/g,
      /icici\s+bank(?:\s+limited)?/g,
      /state\s+bank\s+of\s+india/g,
      /sbi(?:\s+bank)?/g,
      /axis\s+bank(?:\s+limited)?/g,
      /kotak\s+mahindra\s+bank/g,
      /indusind\s+bank(?:\s+limited)?/g,
      /yes\s+bank(?:\s+limited)?/g,
      /hdfc\s+asset\s+management/g,
      
      // Industrial & Manufacturing
      /reliance\s+industries(?:\s+limited)?/g,
      /tata\s+steel(?:\s+limited)?/g,
      /tata\s+motors(?:\s+limited)?/g,
      /mahindra\s+&\s+mahindra/g,
      /larsen\s+&\s+toubro/g,
      /l&t(?:\s+limited)?/g,
      /ultratech\s+cement/g,
      /acc\s+limited/g,
      
      // Energy & Oil
      /reliance\s+petroleum/g,
      /oil\s+and\s+natural\s+gas\s+corporation/g,
      /ongc(?:\s+limited)?/g,
      /indian\s+oil\s+corporation/g,
      /ioc(?:\s+limited)?/g,
      /bharat\s+petroleum/g,
      /bpcl(?:\s+limited)?/g,
      /hindustan\s+petroleum/g,
      /hpcl(?:\s+limited)?/g,
      /ntpc(?:\s+limited)?/g,
      /power\s+grid\s+corporation/g,
      /coal\s+india(?:\s+limited)?/g,
      
      // Telecom
      /bharti\s+airtel(?:\s+limited)?/g,
      /airtel(?:\s+india)?/g,
      /vodafone\s+idea/g,
      /jio(?:\s+platforms)?/g,
      
      // Consumer Goods
      /hindustan\s+unilever(?:\s+limited)?/g,
      /hul(?:\s+limited)?/g,
      /itc(?:\s+limited)?/g,
      /nestle\s+india/g,
      /britannia\s+industries/g,
      /dabur\s+india/g,
      
      // Pharma
      /dr\.?\s+reddy'?s\s+laboratories/g,
      /sun\s+pharmaceutical/g,
      /cipla(?:\s+limited)?/g,
      /lupin(?:\s+limited)?/g,
      /aurobindo\s+pharma/g,
      
      // Adani Group
      /adani\s+enterprises/g,
      /adani\s+ports/g,
      /adani\s+power/g,
      /adani\s+transmission/g,
      /adani\s+green\s+energy/g
    ];

    enhancedCompanyPatterns.forEach(pattern => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        companies.add(this.capitalizeCompanyName(match[0]));
      });
    });

    // 4. Generic company detection patterns
    const genericPatterns = [
      /([a-z]+\s+(?:limited|ltd|inc|corporation|corp|bank|industries|technologies|systems|solutions))/g,
      /([a-z]+\s+&\s+[a-z]+(?:\s+(?:limited|ltd))?)/g,
      /([a-z]+\s+[a-z]+\s+(?:bank|finance|financial|insurance|mutual|fund))/g
    ];

    genericPatterns.forEach(pattern => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        const company = match[1].trim();
        if (company.length > 3 && company.length < 50) {
          companies.add(this.capitalizeCompanyName(company));
        }
      });
    });

    // 5. Extract from structured data mentions
    const structuredPatterns = [
      /company[:\s]+([a-z\s&.]+)/g,
      /issuer[:\s]+([a-z\s&.]+)/g,
      /entity[:\s]+([a-z\s&.]+)/g
    ];

    structuredPatterns.forEach(pattern => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        const company = match[1].trim();
        if (company.length > 3 && company.length < 50) {
          companies.add(this.capitalizeCompanyName(company));
        }
      });
    });

    return Array.from(companies)
      .filter(company => company.length > 2 && !this.isCommonWord(company))
      .sort();
  }

  extractCompanyFromFilename(filename) {
    const cleanName = filename
      .replace(/\.(pdf|doc|docx|xls|xlsx|txt)$/i, '')
      .replace(/[_-]/g, ' ')
      .trim();

    const patterns = [
      /^([a-z\s&.]+?)(?:\s+(?:q[1-4]|fy\d+|20\d+|analyst|call|results?|chunk))/i,
      /^([a-z\s&.]+?)(?:\s+[-_])/i,
      /^([a-z\s&.]+)/i
    ];

    for (const pattern of patterns) {
      const match = cleanName.match(pattern);
      if (match && match[1].length > 2) {
        const company = match[1].trim();
        if (!this.isCommonWord(company) && company.length < 50) {
          return this.capitalizeCompanyName(company);
        }
      }
    }

    return null;
  }

  isCommonWord(word) {
    const commonWords = [
      'limited', 'ltd', 'inc', 'corporation', 'corp', 'company', 'group',
      'the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'report', 'financial', 'annual', 'quarterly', 'results', 'analysis'
    ];
    return commonWords.includes(word.toLowerCase());
  }

  capitalizeCompanyName(name) {
    return name.split(' ')
      .map(word => {
        // Handle special cases
        if (word.toLowerCase() === 'tcs') return 'TCS';
        if (word.toLowerCase() === 'hcl') return 'HCL';
        if (word.toLowerCase() === 'l&t') return 'L&T';
        if (word.toLowerCase() === 'sbi') return 'SBI';
        if (word.toLowerCase() === 'hdfc') return 'HDFC';
        if (word.toLowerCase() === 'icici') return 'ICICI';
        if (word.toLowerCase() === 'ongc') return 'ONGC';
        if (word.toLowerCase() === 'ioc') return 'IOC';
        if (word.toLowerCase() === 'bpcl') return 'BPCL';
        if (word.toLowerCase() === 'hpcl') return 'HPCL';
        if (word.toLowerCase() === 'ntpc') return 'NTPC';
        if (word.toLowerCase() === 'itc') return 'ITC';
        if (word.toLowerCase() === 'hul') return 'HUL';
        
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  getFallbackResponse(query, context) {
    if (context.length === 0) {
      return "I don't have access to any documents. Please ensure the vector database is properly populated.";
    }

    const sources = [...new Set(context.map(item => item.source))];
    return `Based on available documents (${sources.join(', ')}), I can provide information but the AI service is currently limited. Please try rephrasing your question.`;
  }

  async detectChartIntent(query) {
    const lowerQuery = query.toLowerCase();
    
    // Don't create charts for company listing queries
    if (this.isCompanyListQuery(query)) {
      return { needsChart: false, chartType: 'none', dataPoints: [] };
    }
    
    // Enhanced chart detection
    if (lowerQuery.includes('pie chart') || lowerQuery.includes('pie')) {
      return { 
        needsChart: true, 
        chartType: 'pie', 
        dataPoints: ['segment', 'revenue', 'distribution', 'breakdown'] 
      };
    }
    
    if (lowerQuery.includes('line chart') || lowerQuery.includes('line') ||
        lowerQuery.includes('trend') || lowerQuery.includes('over time') || 
        lowerQuery.includes('growth') || lowerQuery.includes('timeline') ||
        lowerQuery.includes('time series')) {
      return { 
        needsChart: true, 
        chartType: 'line', 
        dataPoints: ['quarterly', 'yearly', 'revenue', 'growth', 'time', 'trend'] 
      };
    }
    
    if (lowerQuery.includes('bar chart') || lowerQuery.includes('bar') ||
        lowerQuery.includes('compare') || lowerQuery.includes('comparison') ||
        lowerQuery.includes('quarterly comparison') || lowerQuery.includes('performance')) {
      return { 
        needsChart: true, 
        chartType: 'bar', 
        dataPoints: ['quarterly', 'revenue', 'segment', 'comparison', 'performance'] 
      };
    }
    
    // Enhanced financial chart detection
    const chartIndicators = ['chart', 'graph', 'plot', 'visualize', 'show'];
    const financialTerms = ['revenue', 'profit', 'margin', 'ebitda', 'sales', 'income', 'earnings'];
    
    const hasChartIndicator = chartIndicators.some(term => lowerQuery.includes(term));
    const hasFinancialTerm = financialTerms.some(term => lowerQuery.includes(term));
    
    if (hasChartIndicator && hasFinancialTerm) {
      return { 
        needsChart: true, 
        chartType: 'bar', 
        dataPoints: ['revenue', 'financial', 'metrics', 'quarterly'] 
      };
    }
    
    // Specific quarterly comparison requests
    if (lowerQuery.includes('quarterly') && (hasChartIndicator || lowerQuery.includes('comparison'))) {
      return {
        needsChart: true,
        chartType: 'bar',
        dataPoints: ['quarterly', 'comparison', 'revenue', 'financial']
      };
    }
    
    return { needsChart: false, chartType: 'none', dataPoints: [] };
  }

  async extractChartData(context, dataPoints) {
    const contextText = context.map(item => item.text).join(' ');
    
    console.log('Extracting chart data for:', dataPoints);
    console.log('Context preview:', contextText.substring(0, 200));
    
    let extractedData = [];
    
    // Try quarterly extraction first if requested
    if (dataPoints.includes('quarterly') || dataPoints.includes('comparison')) {
      extractedData = this.extractQuarterlyDataEnhanced(contextText);
      if (extractedData.length >= 2) {
        console.log('Found quarterly data:', extractedData);
        return extractedData;
      }
    }
    
    // Try segment data extraction
    if (dataPoints.includes('segment') || dataPoints.includes('breakdown')) {
      extractedData = this.extractSegmentDataEnhanced(contextText);
      if (extractedData.length >= 2) {
        console.log('Found segment data:', extractedData);
        return extractedData;
      }
    }
    
    // Try financial metrics extraction
    if (dataPoints.includes('revenue') || dataPoints.includes('financial')) {
      extractedData = this.extractFinancialDataEnhanced(contextText);
      if (extractedData.length >= 2) {
        console.log('Found financial data:', extractedData);
        return extractedData;
      }
    }
    
    // Fallback: try to extract any numerical data
    extractedData = this.extractGenericNumericalData(contextText);
    console.log('Fallback data extraction result:', extractedData);
    
    return extractedData;
  }

  extractQuarterlyDataEnhanced(contextText) {
    const quarterlyData = [];
    const text = contextText.toLowerCase();
    
    // Enhanced patterns for different quarterly formats
    const patterns = [
      /((?:q[1-4]|quarter\s+[1-4])\s+fy\s*(?:20)?(?:2[1-6]))[^\d]*?(?:revenue|income|profit|sales|turnover|earnings)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|million|billion|cr|lakh)/gi,
      
      /(fy\s*(?:20)?(?:2[1-6])\s*(?:q[1-4]|quarter\s+[1-4]))[^\d]*?(?:revenue|income|profit|sales|turnover|earnings)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|million|billion|cr)/gi,
      
      /([1-4]q\s*(?:20)?(?:2[1-6]))[^\d]*?(?:revenue|income|profit|sales|turnover|earnings)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|million|billion|cr)/gi,
      
      /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(?:20)?(?:2[1-6]))[^\d]*?(?:revenue|income|profit|sales)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|million|billion|cr)/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const quarter = match[1].trim();
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0) {
          quarterlyData.push({
            label: this.standardizeQuarterLabel(quarter),
            value: value
          });
        }
      }
    });

    // Remove duplicates and sort
    const uniqueData = quarterlyData.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label)
    );

    return uniqueData.sort((a, b) => a.label.localeCompare(b.label));
  }

  extractSegmentDataEnhanced(contextText) {
    const segmentData = [];
    const text = contextText.toLowerCase();
    
    // Enhanced segment patterns
    const segmentPatterns = [
      // Business segments
      /(?:housing|finance|insurance|lending|banking|retail|corporate)\s+(?:segment|division|business)[^\d]*?(?:revenue|income|contribution)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|%)/gi,
      
      // Product segments  
      /(?:personal|home|vehicle|business|commercial)\s+(?:loans?|finance)[^\d]*?(?:revenue|income)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      
      // Geographic segments
      /(?:india|domestic|international|overseas)[^\d]*?(?:revenue|income)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi
    ];

    segmentPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const fullMatch = match[0];
        const value = parseFloat(match[1].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0) {
          // Extract segment name from the full match
          const segmentName = this.extractSegmentName(fullMatch);
          if (segmentName) {
            segmentData.push({
              label: this.capitalizeWords(segmentName),
              value: value
            });
          }
        }
      }
    });

    return segmentData.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label)
    );
  }

  extractFinancialDataEnhanced(contextText) {
    const financialData = [];
    const text = contextText.toLowerCase();
    
    // Enhanced financial metrics patterns
    const metricsPatterns = [
      /(total\s+revenue|net\s+revenue|gross\s+revenue)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(net\s+income|net\s+profit|profit\s+after\s+tax|pat)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(ebitda|operating\s+profit)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(total\s+assets|total\s+liabilities)[^\d]*?(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi
    ];

    metricsPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const metric = match[1].trim();
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0) {
          financialData.push({
            label: this.capitalizeWords(metric),
            value: value
          });
        }
      }
    });

    return financialData.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label)
    );
  }

  extractGenericNumericalData(contextText) {
    const genericData = [];
    const text = contextText.toLowerCase();
    
    const patterns = [
      /([a-z\s]+)[:]\s*(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million)/gi,
      /([a-z\s]+)\s+(?:is|was|of)\s+(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(revenue|profit|income|sales|ebitda|margin)\s*[:]\s*(?:inr|rs\.?|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|%)/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null && genericData.length < 6) {
        const label = match[1].trim();
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0 && label.length > 2 && label.length < 30 && !this.isCommonWord(label)) {
          genericData.push({
            label: this.capitalizeWords(label),
            value: value
          });
        }
      }
    });

    return genericData.slice(0, 5);
  }

  standardizeQuarterLabel(quarter) {
    const q = quarter.toLowerCase();
    
    // Extract quarter number and year
    const quarterMatch = q.match(/([1-4])/);
    const yearMatch = q.match(/(20)?([2-6][1-6])/);
    
    if (quarterMatch && yearMatch) {
      const quarterNum = quarterMatch[1];
      const year = yearMatch[2];
      return `Q${quarterNum} FY${year}`;
    }
    
    return quarter.toUpperCase();
  }

  extractSegmentName(fullMatch) {
    const segments = ['housing', 'finance', 'insurance', 'lending', 'banking', 'retail', 'corporate', 
                     'personal', 'home', 'vehicle', 'business', 'commercial', 'india', 'domestic', 'international'];
    
    const lowerMatch = fullMatch.toLowerCase();
    for (const segment of segments) {
      if (lowerMatch.includes(segment)) {
        return segment;
      }
    }
    
    return null;
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