import sys
import json
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('paraphrase-MiniLM-L3-v2')

text = sys.stdin.read().strip()

embedding = model.encode(text)

if len(embedding) != 384:
    if len(embedding) < 384:
        embedding = np.pad(embedding, (0, 384 - len(embedding)), 'constant')
    else:
        embedding = embedding[:384]

embedding_list = embedding.tolist()
print(json.dumps(embedding_list))