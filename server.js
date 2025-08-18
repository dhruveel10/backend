require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { spawn } = require('child_process');

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const index = pc.index('bull-ai-v2');

function chunkText(text, chunkSize = 4000, overlap = 200) {
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
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
    
    start = end - overlap;
    
    if (start >= text.length) break;
  }
  
  return chunks;
}
async function generateEmbeddingsBatch(texts) {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [path.join(__dirname, 'embeddings.py')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let error = '';
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python process exited with code ${code}`);
        console.error(`Python stderr: ${error}`);
        reject(new Error(`Python script failed with code ${code}: ${error}`));
        return;
      }
      
      try {
        const embeddings = JSON.parse(output.trim());
        resolve(embeddings);
      } catch (e) {
        console.error(`Failed to parse Python output: ${output.substring(0, 500)}`);
        reject(new Error(`Failed to parse embeddings: ${e.message}`));
      }
    });
    
    python.on('error', (err) => {
      console.error(`Python process error: ${err.message}`);
      reject(err);
    });
    
    python.stdin.on('error', (err) => {
      if (err.code === 'EPIPE') {
        console.error('EPIPE error: Python process closed unexpectedly');
      }
      reject(err);
    });
    
    try {
      const jsonData = JSON.stringify(texts);
      python.stdin.write(jsonData);
      python.stdin.end();
    } catch (err) {
      console.error(`Error writing to Python process: ${err.message}`);
      reject(err);
    }
  });
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
    
    const embeddingBatchSize = 50; 
    const uploadBatchSize = 100;   
    let totalUploaded = 0;
    
    const allVectors = [];
    
    for (let i = 0; i < chunks.length; i += embeddingBatchSize) {
      const batch = chunks.slice(i, i + embeddingBatchSize);
      console.log(`Generating embeddings for chunks ${i + 1}-${Math.min(i + batch.length, chunks.length)}/${chunks.length}`);
      
      const embeddings = await generateEmbeddingsBatch(batch);
      
      for (let j = 0; j < batch.length; j++) {
        allVectors.push({
          id: `${fileName}_chunk_${i + j}`,
          values: embeddings[j],
          metadata: {
            text: batch[j],
            source: fileName,
            chunkIndex: i + j
          }
        });
      }
    }
    
    console.log(`Generated all ${allVectors.length} embeddings for ${fileName}`);
    
    for (let i = 0; i < allVectors.length; i += uploadBatchSize) {
      const uploadBatch = allVectors.slice(i, i + uploadBatchSize);
      await index.upsert(uploadBatch);
      totalUploaded += uploadBatch.length;
      console.log(`Uploaded batch ${Math.floor(i/uploadBatchSize) + 1} for ${fileName} (${totalUploaded}/${allVectors.length})`);
    }
    
    console.log(`Completed ${fileName}: ${totalUploaded} vectors uploaded`);
  } catch (error) {
    console.error(`Error processing ${path.basename(filePath)}: ${error.message}`);
  }
}

// Process PDFs sequentially to avoid resource conflicts
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