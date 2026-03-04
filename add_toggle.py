import os
import glob
from bs4 import BeautifulSoup
import re

# Update Logo CSS in both style files
for css_file in ["styles.css", "styles-enterprise.css"]:
    if os.path.exists(css_file):
        with open(css_file, "r") as f:
            content = f.read()
        
        # We replace the nav-brand img block
        if ".nav-brand img" in content:
            content = re.sub(
                r'\.nav-brand img\s*\{[^}]+\}',
                '.nav-brand img {\n    height: 58px;\n    width: auto;\n    object-fit: contain;\n    transform: scale(1.15) translateY(2px);\n    transform-origin: left center;\n}',
                content
            )
            with open(css_file, "w") as f:
                f.write(content)

# Add Toggle to English files
en_files = glob.glob("*.html")
for f_path in en_files:
    # only if it has a navbar
    with open(f_path, "r") as f:
        html = f.read()
    
    if '<div class="nav-actions">' in html and 'nav-lang-toggle' not in html:
        button_html = f'''            <a href="es/{os.path.basename(f_path)}" class="nav-lang-toggle" style="margin-right: 1.5rem; color: var(--text-secondary); text-decoration: none; font-weight: 700; font-size: 0.95rem; transition: color 0.2s; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-globe"></i> ES
            </a>\n            <a'''
        html = re.sub(r'            <a(?=[^>]*class="btn)', button_html, html, count=1)
        with open(f_path, "w") as f:
            f.write(html)

# Add Toggle to Spanish files
es_files = glob.glob("es/*.html")
for f_path in es_files:
    with open(f_path, "r") as f:
        html = f.read()
    
    if '<div class="nav-actions">' in html and 'nav-lang-toggle' not in html:
        button_html = f'''            <a href="../{os.path.basename(f_path)}" class="nav-lang-toggle" style="margin-right: 1.5rem; color: var(--text-secondary); text-decoration: none; font-weight: 700; font-size: 0.95rem; transition: color 0.2s; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-globe"></i> EN
            </a>\n            <a'''
        html = re.sub(r'            <a(?=[^>]*class="btn)', button_html, html, count=1)
        with open(f_path, "w") as f:
            f.write(html)

print("Toggle added and logo adjusted!")
