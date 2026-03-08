import os
import re
from bs4 import BeautifulSoup

def get_new_footer(is_es=False):
    prefix = '../' if is_es else ''
    
    if is_es:
        # Spanish footer
        return f'''
    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <img src="{prefix}assets/logo.png" alt="RateTap" style="height: 40px; margin-bottom: 1.5rem; mix-blend-mode: multiply;">
                    <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 300px;">El estándar en gestión de reputación premium para hostelería.</p>
                </div>
                <div class="footer-links">
                    <h4>Plataforma</h4>
                    <a href="#">Flujo de Sentimiento</a>
                    <a href="#">Seguimiento de Staff</a>
                    <a href="#">Empresas</a>
                </div>
                <div class="footer-links">
                    <h4>Compañía</h4>
                    <a href="{prefix}es/case-studies.html">Casos de Éxito</a>
                    <a href="{prefix}es/roi-calculator.html">Calculadora de ROI</a>
                    <a href="#">Contacto</a>
                </div>
                <div class="footer-links">
                    <h4>Conectar</h4>
                    <div class="social-links">
                        <a href="#"><i class="fa-brands fa-twitter"></i></a>
                        <a href="#"><i class="fa-brands fa-instagram"></i></a>
                        <a href="#"><i class="fa-brands fa-linkedin"></i></a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 RateTap. Todos los derechos reservados.</p>
                <div class="legal-links">
                    <a href="#">Política de Privacidad</a>
                    <a href="#">Términos de Servicio</a>
                </div>
            </div>
        </div>
    </footer>
'''
    else:
        # English footer
        return f'''
    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <img src="{prefix}assets/logo.png" alt="RateTap" style="height: 40px; margin-bottom: 1.5rem; mix-blend-mode: multiply;">
                    <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 300px;">The standard in premium hospitality reputation management.</p>
                </div>
                <div class="footer-links">
                    <h4>Platform</h4>
                    <a href="#">Sentiment Flow</a>
                    <a href="#">Staff Tracking</a>
                    <a href="#">Enterprise</a>
                </div>
                <div class="footer-links">
                    <h4>Company</h4>
                    <a href="{prefix}case-studies.html">Case Studies</a>
                    <a href="{prefix}roi-calculator.html">ROI Calculator</a>
                    <a href="#">Contact</a>
                </div>
                <div class="footer-links">
                    <h4>Connect</h4>
                    <div class="social-links">
                        <a href="#"><i class="fa-brands fa-twitter"></i></a>
                        <a href="#"><i class="fa-brands fa-instagram"></i></a>
                        <a href="#"><i class="fa-brands fa-linkedin"></i></a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 RateTap. All rights reserved.</p>
                <div class="legal-links">
                    <a href="#">Privacy Policy</a>
                    <a href="#">Terms of Service</a>
                </div>
            </div>
        </div>
    </footer>
'''

def process_file(filepath):
    # Don't touch the reference index.html
    if filepath == './index.html':
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        html_doc = f.read()

    # Fast regex replacements for variables and classes
    html_doc = html_doc.replace('var(--primary)', 'var(--brand-charcoal)')
    html_doc = html_doc.replace('var(--secondary)', 'var(--brand-blue)')
    html_doc = html_doc.replace('var(--bg-muted)', 'rgba(255,255,255,0.7)')
    html_doc = html_doc.replace('var(--text-light)', 'var(--text-secondary)')
    html_doc = html_doc.replace('var(--text-muted)', 'var(--text-secondary)')
    html_doc = html_doc.replace('var(--accent)', 'var(--brand-gold)')
    html_doc = html_doc.replace('var(--radius-lg)', '24px')
    
    html_doc = html_doc.replace('class="highlight-blue"', 'class="serif-italic"')
    html_doc = html_doc.replace('class="reveal section section bg-primary"', 'class="reveal section section bg-muted" style="background: var(--brand-charcoal); color: white; text-align: center;"')
    html_doc = html_doc.replace('class="reveal section section bg-muted"', 'class="reveal section bg-muted"')
    
    soup = BeautifulSoup(html_doc, 'html.parser')
    is_es = '/es/' in filepath or filepath.startswith('./es/') or filepath.startswith('es/')
    
    # Update Footer
    footer = soup.find('footer', class_='footer')
    if footer:
        new_footer_html = get_new_footer(is_es)
        new_footer_soup = BeautifulSoup(new_footer_html, 'html.parser').footer
        footer.replace_with(new_footer_soup)
    
    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        # write out string while trying to avoid BS4 messing up formatting too much
        # Since we use BS4 for footer, let's just write str(soup)
        f.write(str(soup))

    print(f"Fixed UI for {filepath}")

# Gather files
files_to_process = []
for root, dirs, files in os.walk('.'):
    for file in files:
        if file.endswith('.html'):
            filepath = os.path.join(root, file)
            files_to_process.append(filepath)

for fp in files_to_process:
    process_file(fp)
