const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');

class NewsService {
  constructor() {
    this.rssParser = new Parser({
      customFields: {
        item: ['pubDate', 'description', 'content', 'contentEncoded', 'summary']
      }
    });
    
    // Popular news RSS feeds
    this.feeds = [
      'https://rss.cnn.com/rss/edition.rss',
      'https://feeds.bbci.co.uk/news/rss.xml',
      'https://www.reuters.com/rssFeed/worldNews',
      'https://rssfeeds.usatoday.com/usatoday-NewsTopStories',
      'https://feeds.npr.org/1001/rss.xml',
      'https://feeds.feedburner.com/ndtv/Lsgd',
      'https://feeds.hindustantimes.com/HT/TopNews',
      'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
      'https://www.indiatoday.in/rss/1206514',
      'https://indianexpress.com/section/india/feed/'
    ];
  }

  async fetchNewsArticles(maxArticles = 50) {
    console.log('Starting news article fetching...');
    const articles = [];
    let articlesPerFeed = Math.ceil(maxArticles / this.feeds.length * 2);
    
    for (const feedUrl of this.feeds) {
      try {
        console.log(`Fetching from: ${feedUrl}`);
        const feed = await this.rssParser.parseURL(feedUrl);
        
        const feedItems = feed.items.slice(0, articlesPerFeed);
        const feedArticles = [];
        
        for (const item of feedItems) {
          const articleUrl = item.link || item.guid || '';
          let fullContent = this.extractContent(item);
          
          if (articleUrl && fullContent.length < 200) {
            try {
              console.log(`  Scraping: ${item.title?.substring(0, 50)}...`);
              const scrapedContent = await this.scrapeArticleContent(articleUrl);
              if (scrapedContent && scrapedContent.length > fullContent.length) {
                fullContent = scrapedContent;
                console.log(`  ✓ Scraped ${scrapedContent.length} chars`);
              }
              await this.sleep(1500);
            } catch (error) {
              console.warn(`  ✗ Failed to scrape ${articleUrl}: ${error.message}`);
            }
          }
          
          feedArticles.push({
            id: this.generateArticleId(articleUrl),
            title: item.title || 'Untitled',
            content: fullContent,
            url: articleUrl,
            publishDate: item.pubDate || item.isoDate || new Date().toISOString(),
            source: feed.title || this.extractSourceFromUrl(feedUrl),
            category: this.categorizeArticle(item.title || ''),
            summary: this.extractSummary({ ...item, content: fullContent })
          });
        }
        
        articles.push(...feedArticles);
        console.log(`Fetched ${feedArticles.length} articles from ${feed.title}`);
        
        if (articles.length >= maxArticles) {
          break;
        }
        
        //Adding delay to avoid rate limiting
        await this.sleep(1000);
        
      } catch (error) {
        console.warn(`Failed to fetch from ${feedUrl}:`, error.message);
        continue;
      }
    }
    
    const finalArticles = articles.slice(0, maxArticles);
    console.log(`Total articles fetched: ${finalArticles.length}`);
    
    return finalArticles;
  }

  extractContent(item) {
    const contentSources = [
      item['content:encoded'],
      item.contentEncoded,
      item.content,
      item.description,
      item.summary
    ];
    
    for (const source of contentSources) {
      if (source) {
        const cleanContent = this.stripHtml(source);
        if (cleanContent.length > 100) {
          return cleanContent;
        }
      }
    }
    
    return item.title || 'No content available';
  }

  stripHtml(html) {
    if (!html) return '';
    
    try {
      const $ = cheerio.load(html);
      return $.text().trim().replace(/\s+/g, ' ');
    } catch (error) {
      return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  extractSummary(item) {
    const content = item.content || this.extractContent(item);
    if (content.length > 300) {
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const firstTwoSentences = sentences.slice(0, 2).join('. ').trim();
      return firstTwoSentences.length > 50 ? firstTwoSentences + '.' : content.substring(0, 200) + '...';
    }
    return content;
  }

  generateArticleId(url) {
    if (!url) return Math.random().toString(36).substr(2, 9);
    
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; 
    }
    return Math.abs(hash).toString(36);
  }

  extractSourceFromUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '').replace('rss.', '').replace('feeds.', '');
    } catch (error) {
      return 'Unknown Source';
    }
  }

  categorizeArticle(title) {
    const categories = {
      'technology': ['tech', 'ai', 'software', 'internet', 'digital', 'cyber'],
      'business': ['business', 'economy', 'market', 'finance', 'trade', 'money'],
      'politics': ['politics', 'government', 'election', 'policy', 'parliament'],
      'health': ['health', 'medical', 'disease', 'vaccine', 'hospital'],
      'sports': ['sports', 'football', 'cricket', 'tennis', 'olympics'],
      'world': ['world', 'international', 'global', 'country', 'war']
    };
    
    const lowerTitle = title.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => lowerTitle.includes(keyword))) {
        return category;
      }
    }
    
    return 'general';
  }

  async scrapeArticleContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      $('script, style, nav, header, footer, aside, .advertisement, .ads, .social-share').remove();
      
      const contentSelectors = [
        'article p',
        '.article-content p', 
        '.post-content p',
        '.entry-content p',
        '.content p',
        '.story-body p',
        '.article-body p',
        'main p',
        '[class*="content"] p',
        '[class*="article"] p',
        '[class*="story"] p'
      ];
      
      let content = '';
      for (const selector of contentSelectors) {
        const paragraphs = $(selector);
        if (paragraphs.length > 2) {
          content = paragraphs.map((i, el) => $(el).text().trim()).get()
            .filter(text => text.length > 50)
            .join(' ');
          if (content.length > 200) break;
        }
      }
      
      if (!content || content.length < 100) {
        const allParagraphs = $('p');
        content = allParagraphs.map((i, el) => $(el).text().trim()).get()
          .filter(text => text.length > 50 && !text.includes('cookie') && !text.includes('subscribe'))
          .slice(0, 10)
          .join(' ');
      }
      
      return content.replace(/\s+/g, ' ').trim().substring(0, 5000);
      
    } catch (error) {
      throw new Error(`Scraping failed: ${error.message}`);
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  chunkArticle(article, maxChunkSize = 500) {
    const chunks = [];
    const content = article.content;
    
    if (content.length <= maxChunkSize) {
      return [{
        ...article,
        chunk: 0,
        chunkContent: content
      }];
    }
    
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push({
          ...article,
          chunk: chunkIndex,
          chunkContent: currentChunk.trim(),
          id: `${article.id}_chunk_${chunkIndex}`
        });
        currentChunk = sentence;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence.trim();
      }
    }
    
    if (currentChunk.trim().length > 0) {
      chunks.push({
        ...article,
        chunk: chunkIndex,
        chunkContent: currentChunk.trim(),
        id: `${article.id}_chunk_${chunkIndex}`
      });
    }
    
    return chunks;
  }
}

module.exports = { NewsService };