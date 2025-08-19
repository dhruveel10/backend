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

async function clearExistingIndex() {
  try {
    console.log('Clearing existing index...');
    await index.deleteAll();
    console.log('Index cleared successfully');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (error) {
    console.error('Error clearing index:', error.message);
    throw error;
  }
}

async function analyzeWithGemini(text, analysisType) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    let prompt = '';
    
    if (analysisType === 'company') {
      prompt = `Extract the company name from this text. Return only the company name, nothing else:\n\n${text.substring(0, 2000)}`;
    } else if (analysisType === 'table_detection') {
      prompt = `Analyze this text and identify table-like structures containing financial data. Look for:
- Multiple columns of data separated by spaces or tabs
- Financial terms like revenue, profit, Q1, Q2, FY, crores, etc.
- Numerical data in structured format

Return a JSON array of objects with startLine, endLine, and confidence (0-1) for each table found:

${text.substring(0, 4000)}`;
    } else if (analysisType === 'financial_sections') {
      prompt = `Identify financial performance sections in this text. Look for sections with headers like:
- Financial Performance, Quarterly Results, Revenue Analysis, etc.

Return a JSON array with section headers and their approximate locations:

${text.substring(0, 4000)}`;
    }
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.log(`Gemini analysis failed for ${analysisType}:`, error.message);
    return null;
  }
}

function extractCompanyFromFilename(filename) {
  const cleanName = filename
    .replace(/\.(pdf|doc|docx|xls|xlsx|txt)$/i, '')
    .replace(/[_-]/g, ' ')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .trim();

  if (cleanName.length < 3 || /^[0-9a-f\s-]+$/i.test(cleanName)) {
    return null;
  }

  const patterns = [
    /^([a-z\s&.]+?)(?:\s+(?:q[1-4]|fy\d+|20\d+|analyst|call|results?|chunk))/i,
    /^([a-z\s&.]+?)(?:\s+[-_])/i,
    /^([a-z\s&.]+)/i
  ];

  for (const pattern of patterns) {
    const match = cleanName.match(pattern);
    if (match && match[1].length > 2) {
      return match[1].trim();
    }
  }
  return cleanName || null;
}

async function detectCompanyFromContent(text) {
  const geminiResult = await analyzeWithGemini(text, 'company');
  if (geminiResult) {
    const cleanCompany = geminiResult.replace(/['"]/g, '').trim();
    if (cleanCompany.length > 2 && cleanCompany.length < 100) {
      return cleanCompany;
    }
  }
  
  const companyPatterns = [
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Limited|Ltd|Inc|Corporation|Corp|Energy|India)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Power|Industries|Finance|Bank)/gi
  ];

  for (const pattern of companyPatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const company = matches[0].replace(/Limited|Ltd|Inc|Corporation|Corp|Energy|India/gi, '').trim();
      if (company.length > 3 && company.length < 50) {
        return company;
      }
    }
  }
  return 'Unknown Company';
}

async function detectTabularData(text) {
  console.log('Using enhanced table detection...');
  
  const geminiResult = await analyzeWithGemini(text, 'table_detection');
  let geminiTables = [];
  
  if (geminiResult) {
    try {
      const parsed = JSON.parse(geminiResult);
      if (Array.isArray(parsed)) {
        geminiTables = parsed.filter(t => t.confidence > 0.6);
        console.log(`Gemini detected ${geminiTables.length} high-confidence tables`);
      }
    } catch (e) {
      console.log('Gemini table response not valid JSON, using pattern detection');
    }
  }
  
  const lines = text.split('\n');
  let tabularSections = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (isFinancialTableLine(line)) {
      let tableStart = i;
      let tableLines = [line];
      let j = i + 1;
      
      while (j < lines.length && j < i + 20) {
        const nextLine = lines[j].trim();
        if (nextLine.length === 0) {
          j++;
          continue;
        }
        
        if (isFinancialTableLine(nextLine) || isTableHeaderLine(nextLine)) {
          tableLines.push(nextLine);
          j++;
        } else {
          break;
        }
      }
      
      if (tableLines.length >= 3) {
        const confidence = calculateTableConfidence(tableLines);
        if (confidence > 0.5) {
          tabularSections.push({
            startIndex: tableStart,
            endIndex: j,
            content: tableLines.join('\n'),
            type: 'table',
            confidence: confidence
          });
          console.log(`Table detected: ${tableLines.length} lines, confidence: ${confidence.toFixed(2)}`);
        }
      }
      
      i = j - 1;
    }
  }
  
  if (geminiTables.length > 0) {
    for (const geminiTable of geminiTables) {
      const startLine = Math.max(0, geminiTable.startLine || 0);
      const endLine = Math.min(lines.length, geminiTable.endLine || startLine + 10);
      
      if (endLine > startLine) {
        const tableContent = lines.slice(startLine, endLine).join('\n');
        tabularSections.push({
          startIndex: startLine,
          endIndex: endLine,
          content: tableContent,
          type: 'table',
          confidence: geminiTable.confidence || 0.8
        });
      }
    }
  }
  
  return tabularSections.sort((a, b) => b.confidence - a.confidence);
}

function isFinancialTableLine(line) {
  const hasNumbers = /\d+(?:[,.]?\d+)*/.test(line);
  const hasFinancialTerms = /revenue|profit|income|sales|ebitda|pat|margin|orders|crores?|rs\.?|₹|q[1-4]|fy20\d+/i.test(line);
  const hasPercentages = /\d+(?:\.\d+)?%/.test(line);
  const hasStructure = /\s{2,}/.test(line) || /\t/.test(line);
  
  return hasStructure && (hasNumbers || hasFinancialTerms || hasPercentages);
}

function isTableHeaderLine(line) {
  const headerTerms = /inr\s+crore|q[1-4]fy\d+|yoy%|qoq%|revenue|profit|ebitda|orders|performance/i;
  return headerTerms.test(line) && line.length > 10;
}

function calculateTableConfidence(tableLines) {
  let score = 0;
  let maxScore = tableLines.length * 5;
  
  for (const line of tableLines) {
    if (/\d+(?:[,.]?\d+)*/.test(line)) score += 2;
    if (/revenue|profit|income|sales|ebitda|pat|orders/i.test(line)) score += 2;
    if (/q[1-4]|fy20\d+/i.test(line)) score += 1;
    if (/\s{2,}/.test(line)) score += 1;
    if (/\d+(?:\.\d+)?%/.test(line)) score += 1;
  }
  
  return Math.min(1.0, score / maxScore);
}

async function detectFinancialSections(text) {
  console.log('Using enhanced financial section detection...');
  
  const sections = [];
  const lines = text.split('\n');
  
  const sectionHeaders = [
    /financial\s+performance/i,
    /quarterly\s+results/i,
    /q1\s+.*?performance/i,
    /take\s+you\s+through.*?financial/i,
    /revenue\s+.*?quarter/i,
    /profit.*?quarter/i
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    for (const pattern of sectionHeaders) {
      if (pattern.test(line)) {
        console.log(`Financial section header found: "${line}"`);
        
        let sectionEnd = i + 1;
        let sectionContent = [line];
        
        while (sectionEnd < lines.length && sectionEnd < i + 50) {
          const nextLine = lines[sectionEnd].trim();
          if (nextLine.length === 0) {
            sectionEnd++;
            continue;
          }
          
          sectionContent.push(nextLine);
          sectionEnd++;
          
          if (sectionContent.length > 30) break;
        }
        
        if (sectionContent.length > 5) {
          sections.push({
            startIndex: i,
            endIndex: sectionEnd,
            content: sectionContent.join('\n'),
            type: 'financial_section',
            header: line
          });
          console.log(`Financial section captured: ${sectionContent.length} lines`);
        }
        
        i = sectionEnd - 1;
        break;
      }
    }
  }
  
  return sections;
}

async function intelligentChunking(text, fileName, chunkSize = 2000, overlap = 200) {
  if (!text || text.length === 0) {
    return [];
  }
  
  console.log(`Starting intelligent chunking for ${fileName}...`);
  
  let company = extractCompanyFromFilename(fileName);
  if (!company) {
    company = await detectCompanyFromContent(text);
  }
  
  console.log(`Detected company: ${company}`);
  
  const chunks = [];
  
  const tabularSections = await detectTabularData(text);
  const financialSections = await detectFinancialSections(text);
  
  console.log(`Found ${tabularSections.length} tables and ${financialSections.length} financial sections`);
  
  const allSpecialSections = [...tabularSections, ...financialSections]
    .sort((a, b) => a.startIndex - b.startIndex);
  
  const processedRanges = [];
  
  for (const section of allSpecialSections) {
    if (section.content.length > 100) {
      const enhancedContent = `Company: ${company}
Document: ${fileName}
Section Type: ${section.type}
${section.header ? 'Header: ' + section.header + '\n' : ''}
Confidence: ${section.confidence ? section.confidence.toFixed(2) : 'N/A'}

${section.content}`;
      
      chunks.push({
        text: enhancedContent,
        type: section.type,
        company: company,
        isSpecialContent: true,
        confidence: section.confidence || 0.8
      });
      
      processedRanges.push({
        start: section.startIndex,
        end: section.endIndex
      });
    }
  }
  
  const textLines = text.split('\n');
  let regularText = [];
  
  for (let i = 0; i < textLines.length; i++) {
    const isInSpecialSection = processedRanges.some(range => 
      i >= range.start && i < range.end
    );
    if (!isInSpecialSection) {
      regularText.push(textLines[i]);
    }
  }
  
  const remainingText = regularText.join('\n');
  if (remainingText.trim().length > 500) {
    const regularChunks = createRegularChunks(remainingText, chunkSize, overlap);
    regularChunks.forEach((chunk) => {
      const enhancedChunk = `Company: ${company}
Document: ${fileName}
Content Type: General

${chunk}`;
      chunks.push({
        text: enhancedChunk,
        type: 'regular',
        company: company,
        isSpecialContent: false
      });
    });
  }
  
  console.log(`Created ${chunks.length} chunks (${chunks.filter(c => c.isSpecialContent).length} special, ${chunks.filter(c => !c.isSpecialContent).length} regular)`);
  
  return chunks;
}

function createRegularChunks(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    
    if (end < text.length) {
      let lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start + chunkSize * 0.8) {
        end = lastSpace;
      }
    }
    
    const chunk = text.slice(start, end).trim();
    
    if (chunk.length > 100) {
      chunks.push(chunk);
    }
    
    if (end >= text.length) break;
    
    start = Math.max(start + 1, end - overlap);
    
    if (chunks.length > 100) {
      console.log('Stopping regular chunking at 100 chunks to prevent infinite loop');
      break;
    }
  }
  
  return chunks;
}

async function generateEmbeddingsBatch(chunks) {
  const embeddings = [];
  const batchSize = 10;
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`Generating embeddings ${i + 1}-${Math.min(i + batch.length, chunks.length)}/${chunks.length}`);
    
    const batchEmbeddings = await Promise.all(
      batch.map(async (chunkObj) => {
        try {
          const result = await embeddingModel.embedContent(chunkObj.text);
          return result.embedding.values;
        } catch (error) {
          console.error(`Embedding error for chunk: ${error.message}`);
          return createFallbackEmbedding(chunkObj.text);
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
    
    const chunks = await intelligentChunking(data.text, fileName);
    console.log(`Created ${chunks.length} intelligent chunks`);
    
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
          text: chunks[j].text,
          source: fileName,
          chunkIndex: j,
          company: chunks[j].company,
          contentType: chunks[j].type,
          isSpecialContent: chunks[j].isSpecialContent,
          confidence: chunks[j].confidence
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
  
  await clearExistingIndex();
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(pdfDirectory, file);
    console.log(`\n--- Processing PDF ${i + 1}/${files.length}: ${file} ---`);
    await processPDF(filePath);
  }
  
  console.log('All PDFs processed successfully with enhanced chunking');
}

uploadPDFs('../data');