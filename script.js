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

const SPANISH_SLUG_MAP = {
    'restaurant-review-management-software': 'software-gestion-resenas-restaurantes'
};

const IMAGE_DIMENSIONS = {
    'assets/og-image.png': { width: 2848, height: 1504 },
    'graphic_sales.jpeg': { width: 1080, height: 1350 },
    'hero.png': { width: 1408, height: 768 },
    'ratetap-logo.png': { width: 1024, height: 1024 },
    'og-image.png': { width: 2848, height: 1504 },
    'optimized-image-example-1.webp': { width: 2752, height: 1536 }
};

function isSpanishPage() {
    const path = window.location.pathname || '';
    return path === '/es' || path === '/es/' || path.startsWith('/es/') || path.includes('/es/');
}

function getPrimaryCtaLabel() {
    return isSpanishPage() ? 'Agendar demo' : 'Book a demo';
}

function getDemoPageHref() {
    if (window.location.protocol === 'file:') {
        return 'demo.html';
    }

    return isSpanishPage() ? '/es/demo.html' : '/demo.html';
}

function getPrimaryCtaFallbackHref() {
    return getDemoPageHref();
}

function getNavbarElement() {
    return document.getElementById('navbar') || document.querySelector('.navbar');
}

function normalizeHref(href) {
    if (!href) return '';
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return href;
    }

    try {
        const url = new URL(href, window.location.href);
        // If it's a file:// protocol (local dev), just return the original href to avoid absolute file paths
        if (url.protocol === 'file:') return href;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
        return href;
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
            background: var(--brand-charcoal);
            color: white;
            border: none;
            padding: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
            font-family: 'Outfit', sans-serif;
        }
        .btn-banner-primary:hover {
            background: #000;
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

window.redirectToSpanish = function () {
    localStorage.setItem('ratetap-lang-preference', 'es');
    const currentPath = window.location.pathname.replace(/\/+$/, '');
    const query = window.location.search || '';
    const hash = window.location.hash || '';

    if (currentPath === '/es' || currentPath.startsWith('/es/')) {
        return;
    }

    let pageName = currentPath.split('/').pop();

    // If clean URL is used, pageName might be empty (root) or just the slug
    if (!pageName || pageName === 'index' || pageName === 'index.html') {
        window.location.href = `/es/${query}${hash}`;
    } else {
        // Remove .html extension if present (for local testing)
        pageName = pageName.replace('.html', '');
        const translatedSlug = SPANISH_SLUG_MAP[pageName] || pageName;
        window.location.href = `/es/${translatedSlug}${query}${hash}`;
    }
}

window.dismissSuggestion = function () {
    localStorage.setItem('ratetap-lang-preference', 'en');
    const banner = document.querySelector('.language-suggestion-banner');
    if (banner) banner.remove();
}

function applyImagePerformanceTweaks() {
    const images = document.querySelectorAll('img');
    images.forEach(image => {
        const src = image.getAttribute('src') || '';
        const cleanSrc = src.split('?')[0];
        const fileName = cleanSrc.split('/').pop();
        const directMatch = IMAGE_DIMENSIONS[cleanSrc] || IMAGE_DIMENSIONS[fileName];
        if (directMatch) {
            if (!image.getAttribute('width')) image.setAttribute('width', String(directMatch.width));
            if (!image.getAttribute('height')) image.setAttribute('height', String(directMatch.height));
        }

        if (!image.getAttribute('decoding')) {
            image.setAttribute('decoding', 'async');
        }

        if (!image.getAttribute('loading')) {
            const isCritical = Boolean(image.closest('nav, header, .hero'));
            image.setAttribute('loading', isCritical ? 'eager' : 'lazy');
        }
    });
}

function standardizePrimaryCtas() {
    const standardLabel = getPrimaryCtaLabel();
    const primaryLinkSelector = 'a.btn.btn-primary[href]';

    document.querySelectorAll(primaryLinkSelector).forEach(link => {
        const href = normalizeHref(link.getAttribute('href')).toLowerCase();
        const isDemoOrContactCta = href.includes('demo') || href === '#contact' || href === '/#contact';
        const isProminentPlacement = Boolean(link.closest('.nav-actions, .hero, .hero-cta'));
        if (!isDemoOrContactCta || !isProminentPlacement) return;

        link.textContent = standardLabel;
        link.setAttribute('aria-label', standardLabel);
    });
}

function insertTrustStrip() {
    if (document.querySelector('.trust-strip') || document.querySelector('.hero-trust') || document.querySelector('.hero-proof-row')) return;

    const heroSection = document.querySelector('section.hero')
        || document.querySelector('section.section.bg-muted[style*="padding-top"]');
    if (!heroSection) return;

    const items = isSpanishPage()
        ? ['500+ restaurantes', 'Crecimiento promedio de 4.8★', 'Sin contratos a largo plazo']
        : ['500+ restaurants', '4.8★ average rating growth', 'No long-term contracts'];

    const trustStrip = document.createElement('section');
    trustStrip.className = 'trust-strip reveal';
    trustStrip.innerHTML = `
        <div class="container trust-strip-inner">
            <div class="trust-item"><i class="fa-solid fa-store"></i><span>${items[0]}</span></div>
            <div class="trust-item"><i class="fa-solid fa-star"></i><span>${items[1]}</span></div>
            <div class="trust-item"><i class="fa-solid fa-shield-halved"></i><span>${items[2]}</span></div>
        </div>
    `;

    heroSection.insertAdjacentElement('afterend', trustStrip);
}

function removeFooterPlaceholderLinks() {
    const placeholders = document.querySelectorAll('footer a[href="#"], .footer a[href="#"]');
    placeholders.forEach(link => {
        const label = (link.textContent || '').trim().toLowerCase();
        const isContactLink = label === 'contact' || label === 'contacto';
        if (isContactLink) {
            link.setAttribute('href', `${getDemoPageHref()}#demo-form`);
            return;
        }

        const listItem = link.closest('li');
        if (listItem) {
            listItem.remove();
        } else {
            link.remove();
        }
    });
}

function repairBrokenContactAnchors() {
    const hasContactSection = Boolean(document.getElementById('contact'));
    if (hasContactSection) return;

    const fallbackHref = `${getDemoPageHref()}#demo-form`;
    document.querySelectorAll('a[href="#contact"], a[href="/#contact"]').forEach(link => {
        link.setAttribute('href', fallbackHref);
    });
}

function getFieldWrapper(form, field, wrappers) {
    const wrapper = field.closest('.form-group');
    if (wrapper && wrapper.closest('form') === form) return wrapper;
    return wrappers.find(candidate => candidate.contains(field)) || field.parentElement;
}

function ensureNameField(form, restaurantField) {
    let nameField = form.querySelector('#your-name, [name="your-name"]');
    if (nameField) return nameField;

    const restaurantWrapper = restaurantField.closest('.form-group') || restaurantField.parentElement;
    if (!restaurantWrapper || !restaurantWrapper.parentElement) return null;

    const nameWrapper = restaurantWrapper.cloneNode(true);
    const input = nameWrapper.querySelector('input, textarea');
    if (!input) return null;

    const isSpanish = isSpanishPage();
    input.type = 'text';
    input.id = 'your-name';
    input.name = 'your-name';
    input.value = '';
    input.required = true;
    input.placeholder = isSpanish ? 'Tu Nombre' : 'Your Name';

    const label = nameWrapper.querySelector('label');
    if (label) {
        label.textContent = isSpanish ? 'Tu Nombre' : 'Your Name';
    }

    restaurantWrapper.insertAdjacentElement('afterend', nameWrapper);
    nameField = nameWrapper.querySelector('#your-name, [name="your-name"]');
    return nameField;
}

function simplifyLeadForm(form) {
    if (!form || form.classList.contains('lead-form-simplified')) return;

    const restaurantField = form.querySelector('#restaurant-name, [name="restaurant-name"]');
    let nameField = form.querySelector('#your-name, [name="your-name"]');
    const emailField = form.querySelector('#email, [name="email"], input[type="email"]');
    if (restaurantField && !nameField) {
        nameField = ensureNameField(form, restaurantField);
    }
    if (!restaurantField || !nameField || !emailField) return;

    let wrappers = Array.from(form.querySelectorAll('.form-group')).filter(wrapper => wrapper.closest('form') === form);
    if (!wrappers.length) {
        wrappers = Array.from(form.children).filter(child => {
            return child.matches && child.matches('div') && child.querySelector('input, select, textarea');
        });
    }
    if (!wrappers.length) return;

    const requiredWrappers = new Set([
        getFieldWrapper(form, restaurantField, wrappers),
        getFieldWrapper(form, nameField, wrappers),
        getFieldWrapper(form, emailField, wrappers)
    ]);

    const optionalWrappers = wrappers.filter(wrapper => !requiredWrappers.has(wrapper));
    if (!optionalWrappers.length) return;

    const details = document.createElement('details');
    details.className = 'optional-form-details';

    const summary = document.createElement('summary');
    summary.textContent = isSpanishPage() ? 'Agregar detalles opcionales' : 'Add optional details';
    details.appendChild(summary);

    optionalWrappers.forEach(wrapper => {
        wrapper.querySelectorAll('[required]').forEach(input => input.removeAttribute('required'));
        details.appendChild(wrapper);
    });

    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitButton) {
        form.insertBefore(details, submitButton);
    } else {
        form.appendChild(details);
    }

    form.classList.add('lead-form-simplified');
}

function resolveStickyCtaHref() {
    if (document.getElementById('contact')) return '#contact';
    if (document.getElementById('contact-form')) return '#contact-form';
    if (document.getElementById('demo-form')) return '#demo-form';

    const candidate = document.querySelector('.nav-actions a.btn.btn-primary[href]')
        || document.querySelector('.hero a.btn.btn-primary[href]')
        || document.querySelector('a.btn.btn-primary[href]');
    if (!candidate) return `${getPrimaryCtaFallbackHref()}#demo-form`;

    const href = normalizeHref(candidate.getAttribute('href'));
    const lowerHref = href.toLowerCase();
    if (!href || href === '#') return `${getPrimaryCtaFallbackHref()}#demo-form`;
    if ((lowerHref === '#contact' || lowerHref === '/#contact') && !document.getElementById('contact')) {
        return `${getPrimaryCtaFallbackHref()}#demo-form`;
    }
    if (lowerHref === '/demo' || lowerHref === '/es/demo') return getPrimaryCtaFallbackHref();
    return href;
}

function injectMobileStickyCta() {
    if (document.querySelector('.mobile-sticky-cta')) return;
    if (window.location.pathname.endsWith('/demo') || window.location.pathname.endsWith('/demo.html')) return;

    const ctaBar = document.createElement('div');
    ctaBar.className = 'mobile-sticky-cta';
    ctaBar.innerHTML = `
        <a class="btn btn-primary mobile-sticky-cta-btn" href="${resolveStickyCtaHref()}">${getPrimaryCtaLabel()}</a>
    `;

    document.body.appendChild(ctaBar);
    document.body.classList.add('has-mobile-sticky-cta');
}

// Form handling
function handleFormSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn) return;

    const originalText = submitBtn.textContent;
    const originalDisplay = form.style.display;

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
            form.style.display = originalDisplay || 'flex';
            form.reset();
        }, 5000);
    }, 2000);
}

// Mobile menu toggle
function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;

    const isActive = navMenu.classList.toggle('active');

    // Toggle menu-open class on navbar to prevent hiding on scroll
    const navbar = getNavbarElement();
    if (navbar) {
        navbar.classList.toggle('menu-open', isActive);
    }

    const navToggle = document.querySelector('.nav-toggle');
    if (navToggle) {
        navToggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
    }
}

function ensureMobileMenuToggle() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;

    let navToggle = document.querySelector('.nav-toggle');
    if (!navToggle) {
        const navContainer = navMenu.closest('.nav-container') || document.querySelector('.nav-container');
        if (!navContainer) return;

        navToggle = document.createElement('button');
        navToggle.type = 'button';
        navToggle.className = 'nav-toggle';
        navToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
        navToggle.setAttribute('aria-label', 'Toggle navigation menu');
        navContainer.appendChild(navToggle);
    }

    if (!navMenu.id) {
        navMenu.id = 'nav-menu';
    }

    navMenu.classList.add('is-collapsible');
    navToggle.setAttribute('aria-controls', navMenu.id);
    navToggle.setAttribute('aria-expanded', navMenu.classList.contains('active') ? 'true' : 'false');
    navToggle.addEventListener('click', toggleMobileMenu);
}

function updateFaqIndicator(question, isExpanded) {
    const icon = question.querySelector('i');
    if (icon) {
        icon.classList.remove('fa-plus', 'fa-minus', 'fa-chevron-down', 'fa-chevron-up');
        icon.classList.add(isExpanded ? 'fa-minus' : 'fa-plus');
        icon.style.transform = '';
    }

    const textToggle = question.querySelector('.faq-toggle');
    if (textToggle) {
        textToggle.textContent = isExpanded ? '-' : '+';
    }

    question.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check location
    checkLocationAndSuggestLanguage();

    // Quick-win UX enhancements
    applyImagePerformanceTweaks();
    standardizePrimaryCtas();
    insertTrustStrip();
    removeFooterPlaceholderLinks();
    repairBrokenContactAnchors();

    // Form submission - handled by Formsubmit.co (no JS override)
    const contactForms = document.querySelectorAll('#contact-form');
    contactForms.forEach(form => {
        simplifyLeadForm(form);
    });

    // Mobile menu toggle
    ensureMobileMenuToggle();
    injectMobileStickyCta();

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        if (!question) return;

        updateFaqIndicator(question, item.classList.contains('active'));
        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close others (optional, keep if you want accordion style)
            // faqItems.forEach(faqItem => faqItem.classList.remove('active'));

            if (isActive) {
                item.classList.remove('active');
                updateFaqIndicator(question, false);
            } else {
                item.classList.add('active');
                updateFaqIndicator(question, true);
            }
        });
    });

    // Language switcher in navbar
    const langBtns = document.querySelectorAll('.lang-btn');
    langBtns.forEach(btn => {
        btn.addEventListener('click', function (event) {
            const lang = this.getAttribute('data-lang');
            if (lang === 'es') {
                event.preventDefault();
                redirectToSpanish();
            } else if (lang === 'en') {
                localStorage.setItem('ratetap-lang-preference', 'en');
            }
        });
    });

    // Intersection Observer for Reveal Animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                // Optional: stop observing once revealed
                // revealObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => {
        revealObserver.observe(el);
    });

    // Header Scroll Effect
    const navbar = getNavbarElement();
    let lastScrollY = window.scrollY;

    function handleScroll() {
        if (!navbar) return;
        const currentScrollY = window.scrollY;
        const isMenuOpen = navbar.classList.contains('menu-open');

        if (!isMenuOpen && currentScrollY > lastScrollY && currentScrollY > 100) {
            navbar.classList.add('nav-hidden');
        } else {
            navbar.classList.remove('nav-hidden');
        }

        // Add shadow/background on scroll
        if (currentScrollY > 50) {
            navbar.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
            navbar.style.boxShadow = '0 10px 30px -10px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
            navbar.style.boxShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 8px 32px rgba(0, 0, 0, 0.04)';
        }

        lastScrollY = currentScrollY;
    }
    if (navbar) {
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Check initial state
    }

    // Mouse Move Parallax for Hero Metrics (3D Depth Effect)
    const hero = document.querySelector('.hero');
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
