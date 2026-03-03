(function () {
    const root = document.documentElement;
    root.classList.add("js-ready");

    const menuToggle = document.getElementById("menu-toggle");
    const siteMenu = document.getElementById("site-menu");
    const navLinks = siteMenu ? siteMenu.querySelectorAll("a") : [];

    if (menuToggle && siteMenu) {
        const closeMenu = function () {
            siteMenu.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        };

        menuToggle.addEventListener("click", function () {
            const open = siteMenu.classList.toggle("open");
            menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
        });

        navLinks.forEach(function (link) {
            link.addEventListener("click", closeMenu);
        });

        window.addEventListener("resize", function () {
            if (window.innerWidth >= 930) {
                closeMenu();
            }
        });

        document.addEventListener("click", function (event) {
            if (!siteMenu.classList.contains("open")) {
                return;
            }

            if (!siteMenu.contains(event.target) && !menuToggle.contains(event.target)) {
                closeMenu();
            }
        });
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stepItems = document.querySelectorAll(".step-item");
    const demoHint = document.getElementById("demo-hint");
    const demoDetected = document.getElementById("demo-detected");
    const demoMeta = document.getElementById("demo-meta");
    const demoAction = document.getElementById("demo-action");
    const demoActionMeta = document.getElementById("demo-action-meta");

    function activateStep(stepItem) {
        if (!stepItem || !demoHint || !demoDetected || !demoMeta || !demoAction || !demoActionMeta) {
            return;
        }

        stepItems.forEach(function (item) {
            item.classList.remove("is-active");
        });
        stepItem.classList.add("is-active");

        demoHint.textContent = stepItem.dataset.hint || demoHint.textContent;
        demoDetected.textContent = stepItem.dataset.detected || demoDetected.textContent;
        demoMeta.textContent = stepItem.dataset.meta || demoMeta.textContent;
        demoAction.textContent = stepItem.dataset.action || demoAction.textContent;
        demoActionMeta.textContent = stepItem.dataset.actionMeta || demoActionMeta.textContent;
    }

    stepItems.forEach(function (item) {
        item.tabIndex = 0;
        item.addEventListener("mouseenter", function () {
            activateStep(item);
        });
        item.addEventListener("focus", function () {
            activateStep(item);
        });
        item.addEventListener("click", function () {
            activateStep(item);
        });
    });

    const testimonialData = [
        {
            quote: "\"I stopped carrying ten sticky notes in my head. We close the night with one clear list, and everyone leaves lighter.\"",
            name: "Elena M.",
            role: "General Manager, Neighborhood Kitchen Group"
        },
        {
            quote: "\"The calmer alerts changed the shift tone. We know what to solve first, and guests feel the difference immediately.\"",
            name: "Marcus T.",
            role: "Operations Lead, Harbor Street Dining"
        },
        {
            quote: "\"I finally trust our nightly handoff. Nothing important slips, and my morning starts with clarity instead of scramble.\"",
            name: "Priya R.",
            role: "Owner, Elm & Stone Hospitality"
        }
    ];

    const testimonialCard = document.getElementById("testimonial-card");
    const testimonialQuote = document.getElementById("testimonial-quote");
    const testimonialName = document.getElementById("testimonial-name");
    const testimonialRole = document.getElementById("testimonial-role");
    const testimonialDots = document.querySelectorAll("[data-testimonial-index]");
    let testimonialIndex = 0;
    let testimonialTimer = null;

    function setActiveTestimonial(nextIndex) {
        if (!testimonialQuote || !testimonialName || !testimonialRole || !testimonialDots.length) {
            return;
        }

        testimonialIndex = nextIndex % testimonialData.length;
        const data = testimonialData[testimonialIndex];
        testimonialQuote.textContent = data.quote;
        testimonialName.textContent = data.name;
        testimonialRole.textContent = data.role;

        testimonialDots.forEach(function (dot) {
            const dotIndex = Number(dot.getAttribute("data-testimonial-index"));
            const active = dotIndex === testimonialIndex;
            dot.classList.toggle("dot-active", active);
            dot.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    function stopTestimonialTimer() {
        if (!testimonialTimer) {
            return;
        }
        window.clearInterval(testimonialTimer);
        testimonialTimer = null;
    }

    function startTestimonialTimer() {
        if (prefersReducedMotion.matches || testimonialData.length < 2) {
            return;
        }

        stopTestimonialTimer();
        testimonialTimer = window.setInterval(function () {
            setActiveTestimonial(testimonialIndex + 1);
        }, 6200);
    }

    testimonialDots.forEach(function (dot) {
        dot.addEventListener("click", function () {
            const nextIndex = Number(dot.getAttribute("data-testimonial-index"));
            setActiveTestimonial(nextIndex);
            startTestimonialTimer();
        });
    });

    if (testimonialCard) {
        testimonialCard.addEventListener("mouseenter", stopTestimonialTimer);
        testimonialCard.addEventListener("mouseleave", startTestimonialTimer);
        testimonialCard.addEventListener("focusin", stopTestimonialTimer);
        testimonialCard.addEventListener("focusout", startTestimonialTimer);
    }

    const sectionLinks = Array.from(document.querySelectorAll(".nav-link[href^='#']"));
    const sectionTargets = sectionLinks
        .map(function (link) {
            const selector = link.getAttribute("href");
            if (!selector) {
                return null;
            }

            const section = document.querySelector(selector);
            if (!section) {
                return null;
            }

            return { link, section };
        })
        .filter(Boolean);

    function setActiveSectionLink(id) {
        sectionLinks.forEach(function (link) {
            const active = link.getAttribute("href") === `#${id}`;
            link.classList.toggle("is-active", active);
        });
    }

    if (sectionTargets.length && "IntersectionObserver" in window) {
        const sectionObserver = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    setActiveSectionLink(entry.target.id);
                });
            },
            {
                rootMargin: "-35% 0px -55% 0px",
                threshold: 0.01
            }
        );

        sectionTargets.forEach(function (target) {
            sectionObserver.observe(target.section);
        });
    }

    const revealItems = document.querySelectorAll(".reveal");
    if (revealItems.length) {
        if (!("IntersectionObserver" in window)) {
            revealItems.forEach(function (item) {
                item.classList.add("is-visible");
            });
        } else {
            const observer = new IntersectionObserver(
                function (entries, observerRef) {
                    entries.forEach(function (entry) {
                        if (!entry.isIntersecting) {
                            return;
                        }

                        entry.target.classList.add("is-visible");
                        observerRef.unobserve(entry.target);
                    });
                },
                {
                    rootMargin: "0px 0px -10% 0px",
                    threshold: 0.15
                }
            );

            revealItems.forEach(function (item, index) {
                item.style.transitionDelay = `${Math.min(index * 45, 220)}ms`;
                observer.observe(item);
            });
        }
    }

    setActiveTestimonial(0);
    startTestimonialTimer();
})();
