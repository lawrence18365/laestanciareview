import os
import re
from bs4 import BeautifulSoup

def process_file(filepath):
    print(f"Processing {filepath}")
    with open(filepath, 'r', encoding='utf-8') as f:
        html_doc = f.read()

    soup = BeautifulSoup(html_doc, 'html.parser')
    
    is_es = '/es/' in filepath or filepath.startswith('./es/') or filepath.startswith('es/')
    prefix = '../' if is_es else ''

    # 1. Update fonts in <head>
    head = soup.find('head')
    if head:
        # Remove old google fonts
        for link in head.find_all('link', href=re.compile(r'fonts\.(googleapis|gstatic)\.com')):
            link.decompose()
        # Remove old styles.css and font-awesome to avoid duplicates
        for link in head.find_all('link', href=re.compile(r'styles\.css|font-awesome')):
            link.decompose()
            
        # Append new links
        new_links_html = f'''
    <link rel="preload" href="{prefix}styles.css" as="style">
    <link rel="stylesheet" href="{prefix}styles.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
'''
        new_links_soup = BeautifulSoup(new_links_html, 'html.parser')
        head.append(new_links_soup)

    # 2. Insert <div class="ambient-canvas"></div> after <body>
    body = soup.find('body')
    if body:
        if not body.find('div', class_='ambient-canvas'):
            ambient_div = soup.new_tag('div', attrs={'class': 'ambient-canvas'})
            body.insert(0, ambient_div)

    # 3. Standardize <nav class="navbar" id="navbar">
    nav = soup.find('nav', id='navbar') or soup.find('nav', class_='navbar')
    if nav:
        nav_structure = f'''
<nav class="navbar" id="navbar">
    <a href="{prefix}index.html" class="nav-brand">
        <img src="{prefix}assets/logo.png" alt="RateTap">
    </a>
    <div class="nav-menu" id="nav-menu">
        <a href="{prefix}index.html#how-it-works" class="nav-link">How It Works</a>
        <a href="{prefix}index.html#features" class="nav-link">Features</a>
        <a href="{prefix}index.html#faq" class="nav-link">FAQ</a>
    </div>
    <div class="nav-actions">
        <a href="{prefix}demo.html" class="btn btn-primary" style="padding: 0.7rem 1.8rem; font-size: 0.9rem;">Book a demo</a>
    </div>
</nav>
'''
        new_nav = BeautifulSoup(nav_structure, 'html.parser').nav
        nav.replace_with(new_nav)

    # 4. Hero section typography
    hero_sections = soup.find_all('section', class_=re.compile(r'\bhero\b'))
    for hero in hero_sections:
        h1 = hero.find('h1')
        if h1:
            h1.attrs = {} # remove all attributes including classes
            
    # buttons globally or just in hero? "For any page that has a .hero section ... Ensure CTA buttons use class="btn btn-primary" or "btn btn-secondary""
    # Let's do it globally for anything with class="btn" to be safe and consistent.
    for element in soup.find_all(['a', 'button'], class_=re.compile(r'\bbtn\b')):
        classes = element.get('class', [])
        if 'btn-secondary' in classes:
            element['class'] = ['btn', 'btn-secondary']
        else:
            element['class'] = ['btn', 'btn-primary']

    # 5. Standardize .card classes
    for card in soup.find_all('div', class_=re.compile(r'\bcard\b')):
        card['class'] = ['card']
        if card.has_attr('style'):
            del card['style']

    with open(filepath, 'w', encoding='utf-8') as f:
        # Use str(soup) but let's make sure doctype is neat
        f.write(str(soup))

files_to_process = []
for root, dirs, files in os.walk('.'):
    for file in files:
        if file.endswith('.html'):
            filepath = os.path.join(root, file)
            # Skip the reference index.html
            if filepath == './index.html':
                continue
            files_to_process.append(filepath)

for fp in files_to_process:
    process_file(fp)
