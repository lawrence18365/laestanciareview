// Soft IP Detection for Mexico
async function checkLocationAndSuggestLanguage() {
    // Only check if we haven't checked before
    if (localStorage.getItem('ratetap-lang-preference')) return;

    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();

        if (data.country_code === 'MX' && !window.location.pathname.includes('/es/')) {
            showLanguageSuggestion();
        }
    } catch (error) {
        console.log('Location check failed', error);
    }
}

function showLanguageSuggestion() {
    const banner = document.createElement('div');
    banner.className = 'language-suggestion-banner';
    banner.innerHTML = `
        <div class="suggestion-content">
            <p><i class="fa-solid fa-earth-americas"></i> <strong>Hola!</strong> Parece que estás en México.</p>
            <p>¿Prefieres ver el sitio en Español?</p>
            <div class="suggestion-actions">
                <button onclick="redirectToSpanish()" class="btn-banner-primary">Sí, cambiar a Español</button>
                <button onclick="dismissSuggestion()" class="btn-banner-secondary">No, keep English</button>
            </div>
        </div>
    `;
    document.body.appendChild(banner);
    
    // Add FLAT DESIGN styles for the banner dynamically
    const style = document.createElement('style');
    style.textContent = `
        .language-suggestion-banner {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #FFFFFF;
            padding: 24px;
            border: 2px solid #E5E7EB; /* Flat border */
            width: 340px;
            z-index: 10000;
            animation: slideUp 0.4s ease-out;
        }
        .suggestion-content p {
            margin-bottom: 8px;
            color: #111827;
            font-size: 1rem;
            line-height: 1.4;
        }
        .suggestion-actions {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 20px;
        }
        .btn-banner-primary {
            background: #3B82F6;
            color: white;
            border: none;
            padding: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
            font-family: 'Outfit', sans-serif;
        }
        .btn-banner-primary:hover {
            background: #2563EB;
            transform: scale(1.02);
        }
        .btn-banner-secondary {
            background: #F3F4F6;
            color: #111827;
            border: none;
            padding: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
            font-family: 'Outfit', sans-serif;
        }
        .btn-banner-secondary:hover {
            background: #E5E7EB;
            transform: scale(1.02);
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @media (max-width: 480px) {
            .language-suggestion-banner {
                left: 16px;
                right: 16px;
                width: auto;
                bottom: 16px;
            }
        }
    `;
    document.head.appendChild(style);
}

window.redirectToSpanish = function() {
    localStorage.setItem('ratetap-lang-preference', 'es');
    const currentPath = window.location.pathname;
    let pageName = currentPath.split('/').pop();
    
    // If clean URL is used, pageName might be empty (root) or just the slug
    if (!pageName || pageName === 'index.html') {
        window.location.href = '/es/';
    } else {
        // Remove .html extension if present (for local testing)
        pageName = pageName.replace('.html', '');
        window.location.href = '/es/' + pageName;
    }
}

window.dismissSuggestion = function() {
    localStorage.setItem('ratetap-lang-preference', 'en');
    const banner = document.querySelector('.language-suggestion-banner');
    if (banner) banner.remove();
}

// Form handling
function handleFormSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    const isSpanish = window.location.pathname.includes('/es/');
    
    submitBtn.textContent = isSpanish ? 'Procesando...' : 'Processing...';
    submitBtn.disabled = true;
    
    // Simulate form submission
    setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        
        const successMessage = document.createElement('div');
        successMessage.style.padding = '1rem';
        successMessage.style.marginTop = '1rem';
        successMessage.style.background = '#ECFDF5'; // Green 50
        successMessage.style.color = '#065F46'; // Green 800
        successMessage.style.fontWeight = '600';
        successMessage.style.textAlign = 'center';
        
        successMessage.textContent = isSpanish
            ? '¡Gracias! Te contactaremos pronto.'
            : 'Thank you! We\'ll be in touch shortly.';
        
        form.parentNode.insertBefore(successMessage, form);
        form.style.display = 'none';
        
        setTimeout(() => {
            successMessage.remove();
            form.style.display = 'flex'; // Restore as flex container
            form.reset();
        }, 5000);
    }, 2000);
}

// Mobile menu toggle
function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    navMenu.classList.toggle('active');
    
    // Toggle menu-open class on navbar to prevent hiding on scroll
    const navbar = document.getElementById('navbar');
    if (navbar) {
        navbar.classList.toggle('menu-open');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check location
    checkLocationAndSuggestLanguage();

    // Form submission
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', handleFormSubmit);
    }

    // Mobile menu toggle
    const navToggle = document.querySelector('.nav-toggle');
    if (navToggle) {
        navToggle.addEventListener('click', toggleMobileMenu);
    }

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            
            // Close others (optional, keep if you want accordion style)
            // faqItems.forEach(faqItem => faqItem.classList.remove('active'));
            
            if (isActive) {
                item.classList.remove('active');
                question.querySelector('i').style.transform = 'rotate(0deg)';
            } else {
                item.classList.add('active');
                question.querySelector('i').style.transform = 'rotate(180deg)';
            }
        });
    });

    // Language switcher in navbar
    const langBtns = document.querySelectorAll('.lang-btn');
    langBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const lang = this.getAttribute('data-lang');
            if (lang === 'es') {
                redirectToSpanish();
            } else {
                // Already in English
            }
        });
    });

    // Header Scroll Effect & Parallax
    const navbar = document.getElementById('navbar');
    const hero = document.getElementById('hero');
    let lastScrollY = window.scrollY;
    
    function handleScroll() {
        const currentScrollY = window.scrollY;
        
        // Header Hide/Show Logic (Always Transparent)
        // Hide when scrolling down, show when scrolling up
        // BUT: Keep visible if menu is open
        const isMenuOpen = navbar.classList.contains('menu-open');
        
        if (!isMenuOpen && currentScrollY > lastScrollY && currentScrollY > 100) {
            navbar.classList.add('nav-hidden');
        } else {
            navbar.classList.remove('nav-hidden');
        }
        lastScrollY = currentScrollY;
        
        // Simple Parallax for Hero Background - DISABLED for Fixed Effect
        // if (hero) {
        //    hero.style.backgroundPositionY = `${currentScrollY * 0.5}px`;
        // }
    }
    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial state

    // Mouse Move Parallax for Hero Metrics (3D Depth Effect)
    if (hero) {
        hero.addEventListener('mousemove', (e) => {
            const moveX = (e.clientX - window.innerWidth / 2) * 0.01;
            const moveY = (e.clientY - window.innerHeight / 2) * 0.01;
            
            const metrics = document.querySelectorAll('.hero-fullscreen-bg .metric');
            metrics.forEach((metric, index) => {
                const depth = (index + 1) * 2; // Different depth for each card
                metric.style.transform = `translate(${moveX * depth}px, ${moveY * depth}px)`;
            });
        });
        
        // Reset on mouse leave
        hero.addEventListener('mouseleave', () => {
             const metrics = document.querySelectorAll('.hero-fullscreen-bg .metric');
             metrics.forEach(metric => {
                 metric.style.transform = 'translate(0, 0)';
             });
        });
    }
});
