import os
import re
from bs4 import BeautifulSoup

def process_file(filepath):
    print(f"Fixing h1 in {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        html_doc = f.read()

    soup = BeautifulSoup(html_doc, 'html.parser')

    # Remove classes from all h1 tags globally
    for h1 in soup.find_all('h1'):
        if h1.has_attr('class'):
            del h1['class']
        if h1.has_attr('style'):
            del h1['style']

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(str(soup))

files_to_process = []
for root, dirs, files in os.walk('.'):
    for file in files:
        if file.endswith('.html'):
            filepath = os.path.join(root, file)
            if filepath == './index.html':
                continue
            files_to_process.append(filepath)

for fp in files_to_process:
    process_file(fp)
