class ChatService {
  constructor(vectorService, llmService) {
    this.vectorService = vectorService;
    this.llmService = llmService;
    this.sessions = new Map();
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
      
      const searchResults = await this.vectorService.searchSimilar(message, 12);
      const filteredResults = this.removeDuplicates(searchResults);
      
      const chartIntent = await this.detectChartRequest(message, filteredResults);
      
      const response = await this.llmService.generateResponse(
        message, 
        filteredResults, 
        session.history
      );

      let chartData = null;
      if (chartIntent.needsChart) {
        chartData = await this.extractChartDataFromContext(message, filteredResults, chartIntent, response);
        
        if (!chartData || chartData.length < 2) {
          console.log('Chart requested but insufficient data found. No chart will be generated.');
          chartData = null;
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

  async detectChartRequest(message, context) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('chart') || lowerMessage.includes('graph') || 
        lowerMessage.includes('visualize') || lowerMessage.includes('plot') ||
        lowerMessage.includes('show') && (lowerMessage.includes('data') || lowerMessage.includes('comparison'))) {
      
      const company = this.extractCompanyFromMessage(message, context);
      
      if (lowerMessage.includes('quarterly') || lowerMessage.includes('quarter')) {
        return {
          needsChart: true,
          chartType: 'bar',
          dataPoints: ['quarterly', 'comparison'],
          company: company
        };
      }
      
      if (lowerMessage.includes('comparison') || lowerMessage.includes('compare') || lowerMessage.includes('vs')) {
        return {
          needsChart: true,
          chartType: 'bar',
          dataPoints: ['comparison', 'financial'],
          company: company
        };
      }
      
      if (lowerMessage.includes('trend') || lowerMessage.includes('over time') || lowerMessage.includes('growth')) {
        return {
          needsChart: true,
          chartType: 'line',
          dataPoints: ['trend', 'financial'],
          company: company
        };
      }
      
      if (lowerMessage.includes('pie') || lowerMessage.includes('distribution') || lowerMessage.includes('breakdown')) {
        return {
          needsChart: true,
          chartType: 'pie',
          dataPoints: ['distribution', 'segment'],
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
    
    if ((lowerMessage.includes('quarterly') && (lowerMessage.includes('comparison') || lowerMessage.includes('vs'))) ||
        (lowerMessage.includes('q1') && lowerMessage.includes('q2')) ||
        (lowerMessage.includes('fy') && lowerMessage.includes('vs'))) {
      return {
        needsChart: true,
        chartType: 'bar',
        dataPoints: ['quarterly', 'comparison'],
        company: this.extractCompanyFromMessage(message, context)
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
    const words = lowerMessage.split(/\s+/);
    
    if (context && context.length > 0) {
      const sources = context.map(item => item.source.toLowerCase());
      for (const source of sources) {
        for (const word of words) {
          if (word.length > 3 && source.includes(word)) {
            return word;
          }
        }
      }
    }
    
    const potentialCompanies = words.filter(word => 
      word.length > 3 && 
      !['chart', 'graph', 'show', 'data', 'quarterly', 'comparison', 'revenue', 'profit'].includes(word)
    );
    
    return potentialCompanies.length > 0 ? potentialCompanies[0] : null;
  }

  async extractChartDataFromContext(message, context, chartIntent, response) {
    const contextText = context.map(item => item.text).join('\n\n');
    const responseText = response || '';
    const combinedText = contextText + '\n\n' + responseText;
    
    let extractedData = [];
    
    if (chartIntent.dataPoints.includes('quarterly')) {
      extractedData = this.extractQuarterlyChartData(combinedText, chartIntent.company);
      if (extractedData.length >= 2) {
        return extractedData;
      }
    }
    
    if (chartIntent.dataPoints.includes('comparison')) {
      extractedData = this.extractComparisonChartData(combinedText, chartIntent.company);
      if (extractedData.length >= 2) {
        return extractedData;
      }
    }
    
    if (chartIntent.dataPoints.includes('trend')) {
      extractedData = this.extractTrendChartData(combinedText, chartIntent.company);
      if (extractedData.length >= 2) {
        return extractedData;
      }
    }
    
    if (chartIntent.dataPoints.includes('distribution') || chartIntent.dataPoints.includes('segment')) {
      extractedData = this.extractSegmentChartData(combinedText, chartIntent.company);
      if (extractedData.length >= 2) {
        return extractedData;
      }
    }
    
    if (chartIntent.dataPoints.includes('financial')) {
      extractedData = this.extractFinancialChartData(combinedText);
      if (extractedData.length >= 2) {
        return extractedData;
      }
    }
    
    extractedData = this.extractStructuredDataFromResponse(responseText);
    if (extractedData.length >= 2) {
      return extractedData;
    }
    
    return null;
  }

  extractQuarterlyChartData(text, company) {
    const data = [];
    const lowerText = text.toLowerCase();
    
    const patterns = [
      /(q[1-4]\s+fy20[1-3][0-9])[:\s]*[^\d]*?(?:revenue|income|profit|sales|turnover|pat|ebitda)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion)/gi,
      /(fy20[1-3][0-9]\s+q[1-4])[:\s]*[^\d]*?(?:revenue|income|profit|sales|turnover|pat|ebitda)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion)/gi,
      /([1-4]q20[1-3][0-9])[:\s]*[^\d]*?(?:revenue|income|profit|sales|turnover|pat|ebitda)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|million|billion)/gi,
      /(?:revenue|income|profit|sales|turnover|pat|ebitda)[^:]*?(q[1-4]\s+fy20[1-3][0-9])[:\s]*(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /(q[1-4]\s+fy20[1-3][0-9])[^:]*?[:]\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi
    ];

    const foundData = new Map();

    patterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(lowerText)) !== null) {
        let period, value;
        
        if (match.length >= 3) {
          period = match[1];
          value = parseFloat(match[2].replace(/,/g, ''));
        }
        
        if (period && !isNaN(value) && value > 0) {
          const normalizedPeriod = this.normalizePeriod(period);
          if (!foundData.has(normalizedPeriod) || foundData.get(normalizedPeriod) < value) {
            foundData.set(normalizedPeriod, value);
          }
        }
      }
    });

    const bulletPattern = /•\s*([^:]+)[:]\s*([^;]+);?\s*([^;]*)/gi;
    let bulletMatch;
    while ((bulletMatch = bulletPattern.exec(lowerText)) !== null) {
      const metric = bulletMatch[1].trim();
      const data1 = bulletMatch[2].trim();
      const data2 = bulletMatch[3] ? bulletMatch[3].trim() : '';
      
      const quarterlyMatches1 = data1.match(/(q[1-4]\s+fy20[1-3][0-9])[:]\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi);
      const quarterlyMatches2 = data2.match(/(q[1-4]\s+fy20[1-3][0-9])[:]\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi);
      
      [quarterlyMatches1, quarterlyMatches2].forEach(matches => {
        if (matches) {
          matches.forEach(match => {
            const parts = match.split(':');
            if (parts.length >= 2) {
              const period = parts[0].trim();
              const value = parseFloat(parts[1].replace(/,/g, ''));
              
              if (!isNaN(value) && value > 0) {
                const normalizedPeriod = this.normalizePeriod(period);
                const fullLabel = `${normalizedPeriod} ${this.capitalizeWords(metric)}`;
                foundData.set(fullLabel, value);
              }
            }
          });
        }
      });
    }

    for (const [period, value] of foundData) {
      data.push({
        label: period,
        value: value
      });
    }

    if (data.length < 2) {
      return this.parseResponseQuarterlyData(lowerText);
    }

    return data.sort((a, b) => {
      const aYear = a.label.match(/20[1-3][0-9]/);
      const bYear = b.label.match(/20[1-3][0-9]/);
      const aQuarter = a.label.match(/q[1-4]/i);
      const bQuarter = b.label.match(/q[1-4]/i);
      
      if (aYear && bYear) {
        const yearDiff = parseInt(aYear[0]) - parseInt(bYear[0]);
        if (yearDiff !== 0) return yearDiff;
        
        if (aQuarter && bQuarter) {
          return aQuarter[0].toLowerCase().localeCompare(bQuarter[0].toLowerCase());
        }
      }
      
      return a.label.localeCompare(b.label);
    });
  }

  parseResponseQuarterlyData(text) {
    const data = [];
    
    const flexiblePatterns = [
      /(q[1-4]\s+fy20[1-3][0-9])[:\s]*(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /(?:revenue|income|profit|pat)[^:]*?[:]\s*([^;]+)/gi,
      /•[^:]*?(?:revenue|income|profit)[^:]*?[:]\s*([^;]+)/gi
    ];

    flexiblePatterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null && data.length < 8) {
        if (match[1] && match[2]) {
          const period = match[1];
          const value = parseFloat(match[2].replace(/,/g, ''));
          
          if (!isNaN(value) && value > 0) {
            data.push({
              label: this.normalizePeriod(period),
              value: value
            });
          }
        } else if (match[1]) {
          const extracted = match[1];
          const valueMatch = extracted.match(/(\d+(?:,\d+)*(?:\.\d+)?)/);
          
          if (valueMatch) {
            const value = parseFloat(valueMatch[1].replace(/,/g, ''));
            if (!isNaN(value) && value > 0) {
              const context = text.substring(Math.max(0, match.index - 100), match.index + 100);
              const quarterMatch = context.match(/(q[1-4]\s+fy20[1-3][0-9])/i);
              
              const label = quarterMatch ? this.normalizePeriod(quarterMatch[1]) : `Data Point ${data.length + 1}`;
              data.push({
                label: label,
                value: value
              });
            }
          }
        }
      }
    });

    const uniqueData = data.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label && t.value === item.value)
    );

    return uniqueData;
  }

  extractComparisonChartData(text, company) {
    return this.extractQuarterlyChartData(text, company);
  }

  extractTrendChartData(text, company) {
    const data = this.extractQuarterlyChartData(text, company);
    return data.sort((a, b) => {
      const aYear = a.label.match(/20[1-3][0-9]/);
      const bYear = b.label.match(/20[1-3][0-9]/);
      if (aYear && bYear) {
        return parseInt(aYear[0]) - parseInt(bYear[0]);
      }
      return a.label.localeCompare(b.label);
    });
  }

  extractSegmentChartData(text, company) {
    const data = [];
    const lowerText = text.toLowerCase();
    
    const segmentPatterns = [
      /(?:housing|finance|insurance|lending|banking|retail|corporate|personal|commercial)[^:]*?(?:segment|division|business)[^\d]*?(?:revenue|income|contribution)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr|%)/gi,
      /(housing|finance|insurance|lending|banking|retail|corporate|personal|commercial)\s+(?:loans?|finance|segment)[^\d]*?(?:revenue|income)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(india|domestic|international|overseas)[^\d]*?(?:revenue|income)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi
    ];

    segmentPatterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(lowerText)) !== null && data.length < 6) {
        const fullMatch = match[0];
        let value, segmentName;
        
        if (match[2]) {
          segmentName = match[1];
          value = parseFloat(match[2].replace(/,/g, ''));
        } else {
          value = parseFloat(match[1].replace(/,/g, ''));
          segmentName = this.extractSegmentName(fullMatch);
        }
        
        if (!isNaN(value) && value > 0 && segmentName) {
          data.push({
            label: this.capitalizeWords(segmentName),
            value: value
          });
        }
      }
    });

    return data.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label)
    );
  }

  extractFinancialChartData(text) {
    const data = [];
    const lowerText = text.toLowerCase();
    
    const metricsPatterns = [
      /(total\s+revenue|net\s+revenue|gross\s+revenue)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(net\s+income|net\s+profit|profit\s+after\s+tax|pat)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(ebitda|operating\s+profit)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi,
      /(total\s+assets|total\s+liabilities)[^\d]*?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:crores?|cr)/gi
    ];

    metricsPatterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(lowerText)) !== null && data.length < 5) {
        const metric = match[1].trim();
        const value = parseFloat(match[2].replace(/,/g, ''));
        
        if (!isNaN(value) && value > 0) {
          data.push({
            label: this.capitalizeWords(metric),
            value: value
          });
        }
      }
    });

    return data.filter((item, index, self) => 
      index === self.findIndex(t => t.label === item.label)
    );
  }

  extractStructuredDataFromResponse(responseText) {
    const data = [];
    const text = responseText.toLowerCase();
    
    const bulletPatterns = [
      /•([^:]+):\s*(q[1-4]\s+fy20[1-3][0-9]):\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /•([^:]+):\s*(q[1-4]\s+fy20[1-3][0-9]):\s*(\d+(?:,\d+)*(?:\.\d+)?)[^;]*?;\s*(q[1-4]\s+fy20[1-3][0-9]):\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi,
      /•?\s*(?:total\s+)?(?:revenue|profit|income|pat|sales)[^:]*?:\s*(q[1-4]\s+fy20[1-3][0-9]):\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi
    ];

    bulletPatterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null && data.length < 8) {
        if (match.length >= 4) {
          const metric = match[1] ? match[1].trim() : 'Financial Metric';
          const period1 = match[2];
          const value1 = parseFloat(match[3].replace(/,/g, ''));
          
          if (!isNaN(value1) && value1 > 0) {
            data.push({
              label: `${this.normalizePeriod(period1)} ${this.capitalizeWords(metric)}`,
              value: value1
            });
          }
          
          if (match[5] && match[6]) {
            const period2 = match[4];
            const value2 = parseFloat(match[5].replace(/,/g, ''));
            
            if (!isNaN(value2) && value2 > 0) {
              data.push({
                label: `${this.normalizePeriod(period2)} ${this.capitalizeWords(metric)}`,
                value: value2
              });
            }
          }
        }
      }
    });

    if (data.length < 2) {
      const fallbackPatterns = [
        /(q[1-4]\s+fy20[1-3][0-9])[^:]*?:\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi,
        /(revenue|profit|income|pat|sales|ebitda)[^:]*?:\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi
      ];

      fallbackPatterns.forEach(pattern => {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null && data.length < 6) {
          const label = match[1];
          const value = parseFloat(match[2].replace(/,/g, ''));
          
          if (!isNaN(value) && value > 0) {
            data.push({
              label: this.normalizePeriod(label) || this.capitalizeWords(label),
              value: value
            });
          }
        }
      });
    }

    return data;
  }

  normalizePeriod(period) {
    const p = period.toLowerCase().trim();
    
    const quarterMatch = p.match(/q([1-4])/);
    const yearMatch = p.match(/(20[1-3][0-9])/);
    const fyMatch = p.match(/fy(20[1-3][0-9])/);
    
    if (quarterMatch && (yearMatch || fyMatch)) {
      const quarter = quarterMatch[1];
      const year = fyMatch ? fyMatch[1] : yearMatch[1];
      return `Q${quarter} FY${year}`;
    }
    
    if (fyMatch) {
      return `FY${fyMatch[1]}`;
    }
    
    if (yearMatch) {
      return `FY${yearMatch[1]}`;
    }
    
    if (p.includes('2030')) return 'Q1 FY2030';
    if (p.includes('2029')) return 'Q1 FY2029';
    if (p.includes('2028')) return 'Q1 FY2028';
    if (p.includes('2027')) return 'Q1 FY2027';
    if (p.includes('2026')) return 'Q1 FY2026';
    if (p.includes('2025')) return 'Q1 FY2025';
    if (p.includes('2024')) return 'Q1 FY2024';
    if (p.includes('2023')) return 'Q1 FY2023';
    if (p.includes('2022')) return 'Q1 FY2022';
    if (p.includes('2021')) return 'Q1 FY2021';
    if (p.includes('2020')) return 'Q1 FY2020';
    
    return period.toUpperCase();
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
    
    const companyName = company ? this.capitalizeWords(company) : '';
    
    if (lowerQuery.includes('quarterly')) {
      return companyName ? `${companyName} Quarterly Financial Comparison` : 'Quarterly Financial Comparison';
    }
    
    if (lowerQuery.includes('trend')) {
      return companyName ? `${companyName} Financial Trend Analysis` : 'Financial Trend Analysis';
    }
    
    if (lowerQuery.includes('segment') || lowerQuery.includes('distribution')) {
      return companyName ? `${companyName} Business Segment Analysis` : 'Business Segment Analysis';
    }
    
    const titles = {
      line: 'Financial Trend Analysis',
      bar: 'Financial Performance Comparison',
      pie: 'Financial Distribution'
    };
    
    const baseTitle = titles[chartType] || 'Financial Data Visualization';
    return companyName ? `${companyName} ${baseTitle}` : baseTitle;
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSessionHistory(sessionId) {
    const session = this.getSession(sessionId);
    return session.history;
  }
}

module.exports = { ChatService };