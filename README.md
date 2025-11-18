# RateTap - Restaurant Review System

Turn every table into a 5-star review with NFC cards and live dashboards.

## Overview

RateTap is a bilingual (English/Spanish) landing page for a restaurant review system that uses NFC cards to help restaurants collect more positive reviews while managing feedback privately.

## Features

- **Bilingual Support**: Full English and Spanish translations with easy language switching
- **Responsive Design**: Optimized for all devices (desktop, tablet, mobile)
- **Modern UI**: Clean, professional design with smooth animations
- **SEO Optimized**: Proper meta tags and semantic HTML
- **Fast Loading**: Minimal dependencies, optimized performance

## Project Structure

```
review/
├── index.html          # Main website file
├── styles.css          # All styling and responsive design
├── script.js           # Language switcher and interactions
└── README.md          # This file
```

## How to Use

### Local Development

1. Simply open `index.html` in your web browser
2. No build process or server required
3. Edit files directly and refresh to see changes

### Language Switching

- Users can toggle between English (EN) and Spanish (ES) using the buttons in the navigation
- Language preference is saved in browser localStorage
- All content updates dynamically without page reload

### Customization

#### Update Contact Information

In `index.html`, find the CTA button and update the email:

```html
<a href="mailto:hello@ratetap.com" class="btn btn-large btn-white">
```

#### Change Colors

In `styles.css`, update the CSS variables at the top:

```css
:root {
    --primary-color: #FF6B35;     /* Main brand color */
    --secondary-color: #004E89;    /* Secondary brand color */
    --accent-color: #FFC857;       /* Accent color */
}
```

#### Add/Edit Content

To add new content or edit existing text:

1. Add the text to both `en` and `es` objects in `script.js`
2. Add a `data-i18n="your-key"` attribute to the HTML element
3. The content will automatically update based on selected language

## Deployment

### GitHub Pages

1. Push this repository to GitHub
2. Go to Settings → Pages
3. Select the main branch as source
4. Your site will be live at `https://yourusername.github.io/review/`

### Custom Domain

To use a custom domain:

1. Add a `CNAME` file with your domain name
2. Update your DNS settings to point to GitHub Pages
3. Enable HTTPS in GitHub Pages settings

### Other Hosting

Upload all files to any web host:
- Netlify (drag & drop the folder)
- Vercel (connect your GitHub repo)
- Traditional web hosting (FTP upload)

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Key Sections

1. **Hero**: Main value proposition
2. **Problem**: Pain points for restaurant owners
3. **How It Works**: 3-step process
4. **Benefits**: Core value propositions
5. **Features**: Technical feature list
6. **FAQ**: Common questions and answers
7. **Founder Note**: Origin story
8. **CTA**: Call to action with contact

## Performance

- No external dependencies
- Vanilla JavaScript (no frameworks)
- Optimized CSS
- Fast page load times
- Minimal HTTP requests

## Future Enhancements

Consider adding:
- Demo video or animated graphics
- Customer testimonials
- Pricing page
- Blog for SEO
- Analytics tracking (Google Analytics, etc.)
- Contact form integration
- Live chat widget

## Social Media

Instagram: [@ratetapmx](https://www.instagram.com/ratetapmx)

## License

All rights reserved © 2025 RateTap

## Support

For questions or support, contact: hello@ratetap.com
