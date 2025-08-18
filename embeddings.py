import sys
import json
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('paraphrase-MiniLM-L3-v2')

def process_embeddings(texts):
    """Generate embeddings for a batch of texts"""
    embeddings = model.encode(texts, show_progress_bar=False)
    
    processed_embeddings = []
    for embedding in embeddings:
        processed_embeddings.append(embedding.tolist())
    
    return processed_embeddings

import sys
import json
from sentence_transformers import SentenceTransformer
import numpy as np
import traceback

try:
    model = SentenceTransformer('paraphrase-MiniLM-L3-v2')
    
    def process_embeddings(texts):
        if not texts or len(texts) == 0:
            return []
            
        embeddings = model.encode(texts, show_progress_bar=False)
        
        processed_embeddings = []
        for embedding in embeddings:
            processed_embeddings.append(embedding.tolist())
        
        return processed_embeddings

    input_data = sys.stdin.read().strip()
    
    if not input_data:
        print("Error: No input data received", file=sys.stderr)
        sys.exit(1)
    
    texts = json.loads(input_data)
    
    if not isinstance(texts, list):
        print("Error: Input must be a JSON array", file=sys.stderr)
        sys.exit(1)
    
    embeddings = process_embeddings(texts)
    
    print(json.dumps(embeddings))
    
except json.JSONDecodeError as e:
    print(f"JSON decode error: {str(e)}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
    sys.exit(1)