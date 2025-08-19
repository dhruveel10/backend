require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const index = pc.index('financial-chatbot-v3');

function chunkText(text, chunkSize = 3000, overlap = 300) {
  if (!text || text.length === 0) {
    return [];
  }
  
  const maxDocSize = 500000; 
  if (text.length > maxDocSize) {
    console.log(`Warning: Document too large (${text.length} chars), truncating to ${maxDocSize} chars`);
    text = text.substring(0, maxDocSize);
  }
  
  const chunks = [];
  let start = 0;
  
  while (start < text.length && chunks.length < 1000) { 
    let end = start + chunkSize;
    if (end > text.length) end = text.length;
    
    const chunk = text.slice(start, end);
    if (chunk.trim().length > 100) {
      chunks.push(chunk.trim());
    }
    
    start = end - overlap;
    
    if (start >= text.length) break;
  }
  
  return chunks;
}

async function generateEmbeddingsBatch(texts) {
  const embeddings = [];
  const batchSize = 10;
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(`Generating embeddings ${i + 1}-${Math.min(i + batch.length, texts.length)}/${texts.length}`);
    
    const batchEmbeddings = await Promise.all(
      batch.map(async (text) => {
        try {
          const result = await embeddingModel.embedContent(text);
          return result.embedding.values;
        } catch (error) {
          console.error(`Embedding error for text chunk: ${error.message}`);
          return createFallbackEmbedding(text);
        }
      })
    );
    
    embeddings.push(...batchEmbeddings);
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return embeddings;
}

function createFallbackEmbedding(text) {
  const embedding = new Array(768).fill(0);
  const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ');
  const words = cleanText.split(/\s+/).filter(word => word.length > 0);
  
  for (let i = 0; i < words.length && i < 768; i++) {
    const word = words[i];
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) - hash + word.charCodeAt(j)) & 0x7fffffff;
    }
    
    const index = hash % 768;
    embedding[index] += 1 / Math.sqrt(words.length);
  }
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
}

async function processPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    const fileName = path.basename(filePath, '.pdf');
    
    console.log(`Processing ${fileName}... (${data.text.length} characters)`);
    
    if (!data.text || data.text.trim().length === 0) {
      console.log(`Skipping ${fileName}: No text content found`);
      return;
    }
    
    const chunks = chunkText(data.text);
    console.log(`Created ${chunks.length} chunks`);
    
    if (chunks.length === 0) {
      console.log(`Skipping ${fileName}: No valid chunks created`);
      return;
    }
    
    const embeddings = await generateEmbeddingsBatch(chunks);
    
    const allVectors = [];
    for (let j = 0; j < chunks.length; j++) {
      allVectors.push({
        id: `${fileName}_chunk_${j}`,
        values: embeddings[j],
        metadata: {
          text: chunks[j],
          source: fileName,
          chunkIndex: j
        }
      });
    }
    
    console.log(`Generated all ${allVectors.length} embeddings for ${fileName}`);
    
    const uploadBatchSize = 100;
    let totalUploaded = 0;
    
    for (let i = 0; i < allVectors.length; i += uploadBatchSize) {
      const uploadBatch = allVectors.slice(i, i + uploadBatchSize);
      await index.upsert(uploadBatch);
      totalUploaded += uploadBatch.length;
      console.log(`Uploaded batch ${Math.floor(i/uploadBatchSize) + 1} for ${fileName} (${totalUploaded}/${allVectors.length})`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`Completed ${fileName}: ${totalUploaded} vectors uploaded`);
  } catch (error) {
    console.error(`Error processing ${path.basename(filePath)}: ${error.message}`);
  }
}

async function uploadPDFs(pdfDirectory) {
  if (!fs.existsSync(pdfDirectory)) {
    console.error(`Directory ${pdfDirectory} does not exist`);
    return;
  }
  
  const files = fs.readdirSync(pdfDirectory).filter(file => file.endsWith('.pdf'));
  
  if (files.length === 0) {
    console.log('No PDF files found in the directory');
    return;
  }
  
  console.log(`Found ${files.length} PDF files`);
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(pdfDirectory, file);
    console.log(`\n--- Processing PDF ${i + 1}/${files.length}: ${file} ---`);
    await processPDF(filePath);
  }
  
  console.log('All PDFs processed successfully');
}

uploadPDFs('../data');