require('dotenv').config();
const { NewsService } = require('./services/newsService');
const { VectorService } = require('./services/vectorService');
const { JinaEmbeddingService } = require('./services/jinaEmbeddingService');

async function ingestNewsArticles() {
  console.log('Starting News Ingestion Pipeline...');
  console.log('=' .repeat(50));
  
  try {
    const newsService = new NewsService();
    const vectorService = new VectorService();
    const jinaService = new JinaEmbeddingService();
    
    console.log('Checking API connections...');
    const jinaStatus = await jinaService.checkApiStatus();
    console.log(`Jina API: ${jinaStatus.status} - ${jinaStatus.message}`);
    
    console.log('\nStep 1: Fetching news articles...');
    const articles = await newsService.fetchNewsArticles(50);
    
    if (articles.length === 0) {
      console.error('No articles fetched. Exiting...');
      return;
    }
    
    console.log(`Successfully fetched ${articles.length} articles`);
    
    const sourceCount = {};
    const categoryCount = {};
    
    articles.forEach(article => {
      sourceCount[article.source] = (sourceCount[article.source] || 0) + 1;
      categoryCount[article.category] = (categoryCount[article.category] || 0) + 1;
    });
    
    console.log('\nArticle Summary:');
    console.log('Sources:', Object.entries(sourceCount).map(([source, count]) => `${source} (${count})`).join(', '));
    console.log('Categories:', Object.entries(categoryCount).map(([cat, count]) => `${cat} (${count})`).join(', '));
    
    console.log('\nStep 2: Chunking articles...');
    let chunkedArticles = [];
    
    for (const article of articles) {
      const chunks = newsService.chunkArticle(article);
      chunkedArticles.push(...chunks);
    }
    
    console.log(`Created ${chunkedArticles.length} chunks from ${articles.length} articles`);
    
    console.log('\nStep 3: Generating embeddings and storing in vector database...');
    
    try {
      const stats = await vectorService.getStats();
      console.log(`Current database stats: ${stats.totalVectors} vectors, ${stats.dimensions} dimensions`);
    } catch (error) {
      console.log('Database stats not available (new index or connection issue)');
    }
    
    const result = await vectorService.storeNewsArticles(chunkedArticles);
    
    if (result.success) {
      console.log(`Successfully stored ${result.count} article chunks in vector database`);
    }
    
    console.log('\nStep 4: Verifying ingestion...');
    
    try {
      const stats = await vectorService.getStats();
      console.log(`Updated database stats: ${stats.totalVectors} vectors, ${stats.dimensions} dimensions`);
      
      const testQuery = "latest news technology";
      const searchResults = await vectorService.searchSimilar(testQuery, 3);
      
      console.log(`Test search for "${testQuery}":`);
      searchResults.forEach((result, index) => {
        console.log(`  ${index + 1}. [${result.category}] ${result.title?.substring(0, 60)}... (score: ${result.score?.toFixed(3)})`);
      });
      
    } catch (error) {
      console.warn('Could not verify ingestion:', error.message);
    }
    
    console.log('\nNews ingestion completed successfully!');
    console.log('=' .repeat(50));
    
    console.log('\nSUMMARY:');
    console.log(`• Fetched: ${articles.length} news articles`);
    console.log(`• Processed: ${chunkedArticles.length} chunks`);
    console.log(`• Sources: ${Object.keys(sourceCount).length} different news sources`);
    console.log(`• Categories: ${Object.keys(categoryCount).length} different categories`);
    console.log(`• Embeddings: Generated using ${jinaStatus.status === 'connected' ? 'Jina API' : 'fallback method'}`);
    
  } catch (error) {
    console.error('\nIngestion failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  ingestNewsArticles()
    .then(() => {
      console.log('\nProcess completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nProcess failed:', error.message);
      process.exit(1);
    });
}

module.exports = { ingestNewsArticles };