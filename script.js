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
    'assets/logo-new-small.webp': { width: 225, height: 150 },
    'logo-new-small.webp': { width: 225, height: 150 },
    'assets/grupo_estancia_group_logo-small.webp': { width: 160, height: 160 },
    'grupo_estancia_group_logo-small.webp': { width: 160, height: 160 },
    'assets/restaurant_atmosphere.webp': { width: 640, height: 640 },
    'restaurant_atmosphere.webp': { width: 640, height: 640 },
    'og-image.png': { width: 2848, height: 1504 },
    'optimized-image-example-1.webp': { width: 2752, height: 1536 }
};

function isSpanishPage() {
    const path = window.location.pathname || '';
    return path === '/es' || path === '/es/' || path.startsWith('/es/') || path.includes('/es/');
}

const FUNNEL_PAGE_CONFIG = {
    '/es/software-gestion-resenas-restaurantes': {
        primaryCtaLabel: 'Auditoría gratis',
        navHref: '/contacto?offer=google-review-audit&source_page=software-gestion-resenas-restaurantes&source_cluster=spanish-bofu#contacto-form',
        navOffer: 'google-review-audit',
        navSourcePage: 'software-gestion-resenas-restaurantes',
        navSourceCluster: 'spanish-bofu'
    },
    '/es/mejorar-calificacion-google-restaurante': {
        primaryCtaLabel: 'Activar piloto gratis'
    },
    '/es/blog/restaurante-bajo-calificacion-google': {
        primaryCtaLabel: 'Activar piloto gratis',
        navHref: '/es/mejorar-calificacion-google-restaurante?offer=rating-recovery-pilot&source_page=blog-restaurante-bajo-calificacion-google&source_cluster=rating-recovery#contact',
        navOffer: 'rating-recovery-pilot',
        navSourcePage: 'blog-restaurante-bajo-calificacion-google',
        navSourceCluster: 'rating-recovery'
    }
};

function getCurrentPath() {
    const path = window.location.pathname || '/';

    if (window.location.protocol === 'file:') {
        const normalized = path.replace(/\\/g, '/');
        const knownPaths = [...Object.keys(FUNNEL_PAGE_CONFIG), '/es/demo', '/demo', '/es/blog', '/blog'];
        const matched = knownPaths.find(candidate => {
            return normalized.endsWith(`${candidate}.html`) || normalized.endsWith(`${candidate}/index.html`);
        });
        if (matched) return matched;
        if (normalized.endsWith('/index.html')) return '/';
    }

    const withoutIndex = path.replace(/index\.html$/, '');
    const withoutHtml = withoutIndex.replace(/\.html$/, '');
    return withoutHtml.replace(/\/+$/, '') || '/';
}

function getActiveFunnelConfig() {
    return FUNNEL_PAGE_CONFIG[getCurrentPath()] || null;
}

function getPrimaryCtaLabel() {
    const funnelConfig = getActiveFunnelConfig();
    if (funnelConfig?.primaryCtaLabel) {
        return funnelConfig.primaryCtaLabel;
    }

    return isSpanishPage() ? 'Agendar demo' : 'Book a demo';
}

function getDemoPageHref() {
    if (window.location.protocol === 'file:') {
        return 'demo.html';
    }

    return isSpanishPage() ? '/es/demo' : '/demo';
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

function getPageIdentifier() {
    const currentPath = getCurrentPath();
    if (currentPath === '/') return 'home';

    const segments = currentPath.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'home';
}

function getFunnelContext(link) {
    if (!link) return 'inline';
    if (link.dataset.funnelContext) return link.dataset.funnelContext;
    if (link.closest('.nav-actions')) return 'nav';
    if (link.closest('.hero-cta')) return 'hero';
    if (link.closest('.pilot-inline-cta')) return 'mid_page';
    if (link.closest('.blog-rail')) return 'blog_rail';
    if (link.closest('.blog-cta-card')) return 'blog_body';
    if (link.closest('.cta-content')) return 'signup_section';
    if (link.closest('.mobile-sticky-cta')) return 'mobile_sticky';
    if (link.closest('footer')) return 'footer';
    return 'inline';
}

// Map dataLayer event names to Meta Pixel event names. Events not in this map
// are pushed to dataLayer (for GTM/GA4) but not forwarded to Meta.
// whatsapp_click is intentionally NOT mapped — Meta ad sets must never optimize
// for "Contact" on this account.
const META_EVENT_MAP = {
    cta_click: 'SeoTrialCtaClick',
    signup_form_submit: 'TrialSignupSubmit',
    signup_completed: 'CompleteRegistration',
    seo_trial_cta_click: 'SeoTrialCtaClick',
    trial_signup_submit: 'TrialSignupSubmit'
};

function trackLeadEvent(eventName, payload = {}) {
    const eventPayload = {
        page_path: getCurrentPath(),
        page_title: document.title,
        page_language: isSpanishPage() ? 'es' : 'en',
        ...payload
    };

    if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: eventName, ...eventPayload });
    }

    const metaEvent = META_EVENT_MAP[eventName];
    if (metaEvent && typeof window.fbq === 'function') {
        window.fbq('trackCustom', metaEvent, eventPayload);
    }
}

function persistFunnelTouch(payload) {
    try {
        sessionStorage.setItem('ratetap-last-funnel-touch', JSON.stringify({
            ...payload,
            captured_at: Date.now()
        }));
    } catch (error) {
        console.log('Unable to persist funnel touch', error);
    }
}

function readPersistedFunnelTouch() {
    try {
        const raw = sessionStorage.getItem('ratetap-last-funnel-touch');
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function preserveCampaignParams(url) {
    const currentParams = new URLSearchParams(window.location.search || '');
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(param => {
        const value = currentParams.get(param);
        if (value && !url.searchParams.get(param)) {
            url.searchParams.set(param, value);
        }
    });
}

function buildFunnelUrl(link) {
    const rawHref = link.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#')) return null;

    let url;
    try {
        url = new URL(rawHref, window.location.href);
    } catch (error) {
        return null;
    }

    const offer = link.dataset.funnelOffer || url.searchParams.get('offer');
    if (!offer) return url;

    const sourcePage = link.dataset.sourcePage || url.searchParams.get('source_page') || getPageIdentifier();
    const sourceCluster = link.dataset.sourceCluster || url.searchParams.get('source_cluster') || '';
    const language = link.dataset.language || url.searchParams.get('language') || (isSpanishPage() ? 'es' : 'en');
    const ctaContext = getFunnelContext(link);

    url.searchParams.set('offer', offer);
    url.searchParams.set('source_page', sourcePage);
    if (sourceCluster) {
        url.searchParams.set('source_cluster', sourceCluster);
    }
    url.searchParams.set('language', language);
    url.searchParams.set('cta_context', ctaContext);
    preserveCampaignParams(url);

    return url;
}

function getFunnelPayload(link) {
    const url = buildFunnelUrl(link);
    const searchParams = url ? url.searchParams : new URLSearchParams();

    return {
        offer: link.dataset.funnelOffer || searchParams.get('offer') || '',
        source_page: link.dataset.sourcePage || searchParams.get('source_page') || getPageIdentifier(),
        source_cluster: link.dataset.sourceCluster || searchParams.get('source_cluster') || '',
        cta_context: getFunnelContext(link),
        destination: url ? normalizeHref(url.toString()) : `${getCurrentPath()}${link.getAttribute('href') || ''}`,
        link_label: (link.textContent || '').trim()
    };
}

function configureOfferFunnels() {
    const funnelConfig = getActiveFunnelConfig();
    if (!funnelConfig?.navHref) return;

    const navCta = document.querySelector('.nav-actions a.btn.btn-primary[href]');
    if (!navCta) return;

    navCta.setAttribute('href', funnelConfig.navHref);
    navCta.dataset.funnelOffer = funnelConfig.navOffer || '';
    navCta.dataset.sourcePage = funnelConfig.navSourcePage || getPageIdentifier();
    navCta.dataset.sourceCluster = funnelConfig.navSourceCluster || '';
    navCta.dataset.funnelContext = 'nav';
    if (funnelConfig.primaryCtaLabel) {
        navCta.textContent = funnelConfig.primaryCtaLabel;
        navCta.setAttribute('aria-label', funnelConfig.primaryCtaLabel);
    }
}

function wireFunnelLinks() {
    const funnelLinks = document.querySelectorAll('a[data-funnel-offer], a[href*="offer="]');

    funnelLinks.forEach(link => {
        const trackedUrl = buildFunnelUrl(link);
        if (trackedUrl && !link.getAttribute('href').startsWith('#')) {
            link.setAttribute('href', normalizeHref(trackedUrl.toString()));
        }

        if (link.dataset.funnelBound === 'true') return;

        link.addEventListener('click', () => {
            const payload = getFunnelPayload(link);
            persistFunnelTouch(payload);
            trackLeadEvent('cta_click', {
                ...payload,
                cta_label: (link.textContent || '').trim().slice(0, 80),
                cta_destination: link.getAttribute('href') || '',
                cta_section: getFunnelContext(link)
            });
        });

        link.dataset.funnelBound = 'true';
    });
}

// Delegated handler: fires cta_click for any .btn link or [data-cta] element
// not already bound by wireFunnelLinks, and whatsapp_click for wa.me links.
function wireGenericCtas() {
    if (document.body.dataset.ctaDelegationBound === 'true') return;
    document.body.dataset.ctaDelegationBound = 'true';

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        const ctaLabel = (link.textContent || '').trim().slice(0, 80);
        const ctaSection = getFunnelContext(link);

        if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)/i.test(href)) {
            trackLeadEvent('whatsapp_click', {
                whatsapp_destination: href,
                cta_label: ctaLabel,
                cta_section: ctaSection
            });
            return;
        }

        if (link.dataset.funnelBound === 'true') return;

        if (link.matches('a.btn') || link.matches('[data-cta]')) {
            trackLeadEvent('cta_click', {
                cta_label: ctaLabel,
                cta_destination: href,
                cta_section: ctaSection
            });
        }
    }, true);
}

// Fires once when a visitor lands on the self-serve signup page.
function fireSignupStarted() {
    const path = getCurrentPath();
    if (!/\/get-started(\.html)?$/.test(path)) return;
    if (sessionStorage.getItem('ratetap-signup-started-fired') === '1') return;

    const persistedTouch = readPersistedFunnelTouch() || {};
    const params = new URLSearchParams(window.location.search || '');
    trackLeadEvent('signup_started', {
        source_page: params.get('source_page') || persistedTouch.source_page || 'direct',
        offer: params.get('offer') || persistedTouch.offer || '',
        cta_section: persistedTouch.cta_context || ''
    });
    try { sessionStorage.setItem('ratetap-signup-started-fired', '1'); } catch (e) {}
}

function ensureHiddenInput(form, name, value) {
    let field = form.querySelector(`input[name="${name}"]`);
    if (!field) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = name;
        form.appendChild(field);
    }
    field.value = value;
    return field;
}

function applyLeadAttribution(form) {
    const params = new URLSearchParams(window.location.search || '');
    const persistedTouch = readPersistedFunnelTouch() || {};
    const originCtaContext = params.get('cta_context') || '';
    const lastCtaContext = persistedTouch.cta_context || originCtaContext || form.dataset.defaultContext || 'organic';

    const payload = {
        offer: params.get('offer') || persistedTouch.offer || form.dataset.defaultOffer || '',
        source_page: params.get('source_page') || persistedTouch.source_page || form.dataset.sourcePage || getPageIdentifier(),
        source_cluster: params.get('source_cluster') || persistedTouch.source_cluster || form.dataset.sourceCluster || '',
        cta_context: lastCtaContext,
        origin_cta_context: originCtaContext,
        language: params.get('language') || (isSpanishPage() ? 'es' : 'en'),
        landing_path: getCurrentPath(),
        landing_url: window.location.href,
        referrer: document.referrer || '',
        utm_source: params.get('utm_source') || persistedTouch.utm_source || '',
        utm_medium: params.get('utm_medium') || persistedTouch.utm_medium || '',
        utm_campaign: params.get('utm_campaign') || persistedTouch.utm_campaign || '',
        utm_term: params.get('utm_term') || persistedTouch.utm_term || '',
        utm_content: params.get('utm_content') || persistedTouch.utm_content || ''
    };

    Object.entries(payload).forEach(([name, value]) => {
        ensureHiddenInput(form, name, value);
    });

    return payload;
}

function getLeadApiEndpoint() {
    const override = document.querySelector('meta[name="ratetap-leads-api"]');
    if (override && override.getAttribute('content')) {
        return override.getAttribute('content');
    }

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        return 'http://localhost:3100/api/leads/create';
    }

    return 'https://app.ratetapmx.com/api/leads/create';
}

function getFormFieldValue(form, names) {
    for (const name of names) {
        const field = form.querySelector(`[name="${name}"]`);
        if (field && typeof field.value === 'string' && field.value.trim()) {
            return field.value.trim();
        }
    }
    return '';
}

function shouldUseFirstPartyLeadApi(form) {
    if (form.dataset.firstPartyLeadApi === 'false') return false;
    if (form.dataset.firstPartyLeadApi === 'true') return true;

    const action = form.getAttribute('action') || '';
    return action.includes('formsubmit.co');
}

function getLeadFormStatus(form) {
    let status = form.querySelector('[data-lead-api-status]');
    if (status) return status;

    status = document.createElement('p');
    status.setAttribute('data-lead-api-status', 'true');
    status.setAttribute('aria-live', 'polite');
    status.style.margin = '0.25rem 0 0';
    status.style.fontSize = '0.9rem';

    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitButton) {
        submitButton.insertAdjacentElement('afterend', status);
    } else {
        form.appendChild(status);
    }

    return status;
}

function buildFirstPartyLeadPayload(form, attribution) {
    const firstName = getFormFieldValue(form, ['first_name', 'firstName']);
    const lastName = getFormFieldValue(form, ['last_name', 'lastName']);
    const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();

    return {
        name: getFormFieldValue(form, ['name', 'contact_name', 'contactName', 'your-name']) || joinedName,
        businessName: getFormFieldValue(form, [
            'businessName',
            'business_name',
            'restaurant_name',
            'restaurant-name',
            'restaurant',
            'company',
            'company_name'
        ]),
        email: getFormFieldValue(form, ['email']),
        phone: getFormFieldValue(form, ['phone', 'telefono', 'tel', 'whatsapp']),
        city: getFormFieldValue(form, ['city', 'ciudad']),
        source: attribution.source_page || form.dataset.sourcePage || getPageIdentifier(),
        landingPath: attribution.landing_path || getCurrentPath(),
        utmSource: attribution.utm_source || '',
        utmMedium: attribution.utm_medium || '',
        utmCampaign: attribution.utm_campaign || '',
        utmTerm: attribution.utm_term || '',
        utmContent: attribution.utm_content || '',
        offer: attribution.offer || form.dataset.defaultOffer || 'demo',
        metadata: {
            form_id: form.id || 'lead-form',
            source_cluster: attribution.source_cluster || '',
            cta_context: attribution.cta_context || '',
            origin_cta_context: attribution.origin_cta_context || '',
            language: attribution.language || (isSpanishPage() ? 'es' : 'en'),
            referrer: attribution.referrer || document.referrer || '',
            landing_url: attribution.landing_url || window.location.href,
            preferred_date: getFormFieldValue(form, ['preferred_date', 'preferredDate'])
        }
    };
}

async function submitFirstPartyLeadForm(event, form, attribution) {
    event.preventDefault();

    const status = getLeadFormStatus(form);
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    const originalText = submitButton ? submitButton.textContent : '';

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = isSpanishPage() ? 'Enviando...' : 'Sending...';
    }
    status.style.color = 'var(--text-secondary)';
    status.textContent = isSpanishPage() ? 'Guardando solicitud...' : 'Saving request...';

    try {
        const response = await fetch(getLeadApiEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildFirstPartyLeadPayload(form, attribution)),
            mode: 'cors'
        });

        let result = null;
        try {
            result = await response.json();
        } catch {
            result = null;
        }

        if (!response.ok || !result || result.ok !== true) {
            throw new Error(result && result.error ? result.error : 'lead_api_failed');
        }

        if (typeof fbq === 'function' && result.metaEventId) {
            fbq('track', 'Lead', {
                content_name: 'commercial_lead',
                content_category: 'commercial_lead',
                currency: 'MXN',
                value: 0
            }, { eventID: result.metaEventId });
        }

        const nextUrl = getFormFieldValue(form, ['_next']);
        if (nextUrl) {
            window.location.href = nextUrl;
            return;
        }

        status.style.color = 'var(--success)';
        status.textContent = isSpanishPage()
            ? 'Solicitud recibida. Te contactaremos pronto.'
            : 'Request received. We will contact you shortly.';
        form.reset();
        applyLeadAttribution(form);
    } catch (error) {
        console.error('[lead-form] first-party submission failed:', error);
        status.style.color = 'var(--danger, #b91c1c)';
        status.textContent = isSpanishPage()
            ? 'No pudimos guardar la solicitud. Intenta de nuevo o escríbenos por WhatsApp.'
            : 'We could not save the request. Try again or contact us by WhatsApp.';
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }
}

function wireLeadForms() {
    const leadForms = document.querySelectorAll('form[data-lead-form], #contact-form, #demo-form, #lead-form');

    leadForms.forEach(form => {
        applyLeadAttribution(form);

        if (form.dataset.leadTrackingBound === 'true') return;

        form.addEventListener('submit', (event) => {
            const payload = applyLeadAttribution(form);
            trackLeadEvent('signup_form_submit', {
                ...payload,
                form_id: form.id || 'lead-form'
            });

            if (shouldUseFirstPartyLeadApi(form)) {
                submitFirstPartyLeadForm(event, form, payload);
            }
        });

        form.dataset.leadTrackingBound = 'true';
    });
}

function renderFormThanksState() {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('thanks') !== '1') return;

    const form = document.querySelector('#contact-form, #demo-form, form[data-lead-form]');
    if (!form || form.dataset.thanksRendered === 'true') return;

    const card = document.createElement('div');
    card.className = 'card reveal';
    card.style.padding = '1.5rem';
    card.style.background = 'rgba(77, 166, 255, 0.08)';
    card.style.border = '1px solid rgba(77, 166, 255, 0.2)';
    card.style.marginBottom = '1.25rem';
    card.innerHTML = `
        <strong style="display:block; margin-bottom:0.5rem;">${isSpanishPage() ? 'Recibimos tu solicitud.' : 'We received your request.'}</strong>
        <p style="margin:0; color: var(--text-secondary);">${isSpanishPage() ? 'Te contactaremos pronto para activar el siguiente paso del piloto.' : 'We will reach out shortly with the next step for your pilot.'}</p>
    `;

    form.parentNode.insertBefore(card, form);
    form.style.display = 'none';
    form.dataset.thanksRendered = 'true';
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
        if (link.dataset.preserveLabel === 'true') return;

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
        ? ['Resultados reales comprobados', 'Crecimiento promedio de 4.8★', 'Sin contratos a largo plazo']
        : ['Real proven results', '4.8★ average rating growth', 'No long-term contracts'];

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

    const stickyLink = ctaBar.querySelector('a');
    const sourceLink = document.querySelector('.nav-actions a.btn.btn-primary[href]')
        || document.querySelector('.hero a.btn.btn-primary[href]')
        || document.querySelector('a.btn.btn-primary[href]');
    if (stickyLink && sourceLink) {
        ['funnelOffer', 'sourcePage', 'sourceCluster', 'language'].forEach(key => {
            if (sourceLink.dataset[key]) {
                stickyLink.dataset[key] = sourceLink.dataset[key];
            }
        });
        if (sourceLink.dataset.preserveLabel === 'true') {
            stickyLink.dataset.preserveLabel = 'true';
        }
    }
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
function setMobileMenuState(isActive) {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;

    const navToggle = document.querySelector('.nav-toggle');
    const navbar = getNavbarElement();

    navMenu.classList.toggle('active', isActive);
    document.body.classList.toggle('nav-open', isActive);

    if (navbar) {
        navbar.classList.toggle('menu-open', isActive);
    }

    if (navToggle) {
        navToggle.classList.toggle('active', isActive);
        navToggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
        navToggle.setAttribute('aria-label', isActive ? 'Close navigation menu' : 'Open navigation menu');
        navToggle.innerHTML = isActive
            ? '<i class="fa-solid fa-xmark"></i>'
            : '<i class="fa-solid fa-bars"></i>';
    }
}

function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;

    const isActive = navMenu.classList.contains('active');
    setMobileMenuState(!isActive);
}

function closeMobileMenu() {
    setMobileMenuState(false);
}

function ensureMobileMenuToggle() {
    const navbar = getNavbarElement();
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu || !navbar) return;

    let navToggle = document.querySelector('.nav-toggle');
    if (!navToggle) {
        navToggle = document.createElement('button');
        navToggle.type = 'button';
        navToggle.className = 'nav-toggle';
        navToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
        navToggle.setAttribute('aria-label', 'Open navigation menu');
        const navActions = navbar.querySelector('.nav-actions');
        if (navActions) {
            navActions.insertAdjacentElement('afterend', navToggle);
        } else {
            navbar.appendChild(navToggle);
        }
    }

    if (!navMenu.id) {
        navMenu.id = 'nav-menu';
    }

    navToggle.setAttribute('aria-controls', navMenu.id);
    navToggle.setAttribute('aria-expanded', navMenu.classList.contains('active') ? 'true' : 'false');

    if (navToggle.dataset.mobileNavBound !== 'true') {
        navToggle.addEventListener('click', toggleMobileMenu);
        navToggle.dataset.mobileNavBound = 'true';
    }

    if (navMenu.dataset.mobileNavLinksBound !== 'true') {
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', closeMobileMenu);
        });
        navMenu.dataset.mobileNavLinksBound = 'true';
    }

    if (document.body.dataset.mobileNavOutsideBound !== 'true') {
        document.addEventListener('click', (event) => {
            if (!document.body.classList.contains('nav-open')) return;
            if (!navbar.contains(event.target)) {
                closeMobileMenu();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeMobileMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeMobileMenu();
            }
        });

        document.body.dataset.mobileNavOutsideBound = 'true';
    }

    setMobileMenuState(navMenu.classList.contains('active'));
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
    configureOfferFunnels();
    standardizePrimaryCtas();
    insertTrustStrip();
    removeFooterPlaceholderLinks();
    repairBrokenContactAnchors();
    renderFormThanksState();

    // Form submission - handled by Formsubmit.co (no JS override)
    const contactForms = document.querySelectorAll('#contact-form');
    contactForms.forEach(form => {
        simplifyLeadForm(form);
    });

    // Mobile menu toggle
    ensureMobileMenuToggle();
    injectMobileStickyCta();
    wireFunnelLinks();
    wireLeadForms();
    wireGenericCtas();
    fireSignupStarted();

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
