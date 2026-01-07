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
            <p>🇲🇽 Parece que estás en México. ¿Prefieres ver el sitio en Español?</p>
            <div class="suggestion-actions">
                <button onclick="redirectToSpanish()" class="btn-yes">Sí, cambiar a Español</button>
                <button onclick="dismissSuggestion()" class="btn-no">No, keep English</button>
            </div>
        </div>
    `;
    document.body.appendChild(banner);
    
    // Add styles for the banner dynamically
    const style = document.createElement('style');
    style.textContent = `
        .language-suggestion-banner {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            z-index: 10000;
            border: 1px solid #e5e7eb;
            animation: slideUp 0.5s ease-out;
            width: 90%;
            max-width: 400px;
        }
        .suggestion-content p {
            margin-bottom: 15px;
            font-weight: 600;
            color: #1f2937;
            text-align: center;
        }
        .suggestion-actions {
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        .btn-yes {
            background: #ff6b4a;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
        }
        .btn-no {
            background: #f3f4f6;
            color: #4b5563;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
        }
        @keyframes slideUp {
            from { transform: translate(-50%, 100%); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

window.redirectToSpanish = function() {
    localStorage.setItem('ratetap-lang-preference', 'es');
    // Logic to switch to ES directory counterpart
    const currentPath = window.location.pathname;
    const pageName = currentPath.split('/').pop() || 'index.html'; // Default to index if root
    
    // Handle root path specially if needed, but assuming files are explicit for now
    if (pageName === 'get-more-google-reviews-restaurants.html' || pageName === '') {
         window.location.href = 'es/get-more-google-reviews-restaurants.html';
    } else {
         window.location.href = 'es/' + pageName;
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
    // ... existing logic ...
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    // Determine language based on URL
    const isSpanish = window.location.pathname.includes('/es/');
    
    submitBtn.textContent = isSpanish ? 'Procesando...' : 'Processing...';
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    // Simulate form submission
    setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
        
        const successMessage = document.createElement('div');
        successMessage.className = 'form-success';
        successMessage.textContent = isSpanish
            ? '¡Gracias! Te contactaremos dentro de 24 horas para iniciar tu prueba gratis.'
            : 'Thank you! We\'ll contact you within 24 hours to start your free trial.';
        
        form.parentNode.insertBefore(successMessage, form);
        form.style.display = 'none';
        
        setTimeout(() => {
            successMessage.remove();
            form.style.display = 'block';
            form.reset();
        }, 5000);
    }, 2000);
}

// Mobile menu toggle
function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    const navToggle = document.querySelector('.nav-toggle');
    
    navMenu.classList.toggle('active');
    navToggle.classList.toggle('active');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check location
    checkLocationAndSuggestLanguage();

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href !== '') {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });

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

    // Navbar scroll effect
    let lastScroll = 0;
    const navbar = document.querySelector('.navbar');

    if (navbar) {
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset;

            if (currentScroll > 120) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }

            if (currentScroll > lastScroll && currentScroll > 200) {
                navbar.classList.add('hidden');
            } else {
                navbar.classList.remove('hidden');
            }

            lastScroll = currentScroll;
        });
    }

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            faqItems.forEach(faqItem => faqItem.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });

    // Animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fadeInUp');
            }
        });
    }, observerOptions);

    document.querySelectorAll('.problem-card, .benefit-card, .feature-category, .testimonial-card').forEach(el => {
        observer.observe(el);
    });
    
    // Hover effects
     document.querySelectorAll('.problem-card, .benefit-card, .feature-category, .testimonial-card').forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
});