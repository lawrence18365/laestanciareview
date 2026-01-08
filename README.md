# RateTap - Restaurant Review System

## Overview
RateTap is a static landing page for an NFC-based restaurant review system. The project uses a **Flat Design System** with a "Digital Poster" aesthetic, prioritizing bold typography, geometric shapes, and a high-contrast Blue/White color palette.

## Technology Stack
-   **HTML5**
-   **CSS3** (CSS Variables, Grid, Flexbox)
-   **JavaScript** (Vanilla ES6+)
-   **FontAwesome** (Icons)
-   **Google Fonts** ('Outfit' sans-serif)

## Design System

### Philosophy
The design follows a strict "Flat Design" methodology:
-   **No Drop Shadows**: Depth is created through color contrast and scale.
-   **Geometric Purity**: Elements are strictly rectangular or circular.
-   **Typography as Interface**: Hierarchy is established via font weight (400-800) and size.

### Core Tokens
-   **Primary Color**: `#3B82F6` (Blue 500)
-   **Background**: `#FFFFFF` (White) & `#F3F4F6` (Gray 100)
-   **Typography**: 'Outfit', sans-serif

### Key Components
-   **Buttons**: Solid color blocks, scaling transform on hover.
-   **Cards**: Flat color blocks (`bg-muted`), no borders.
-   **Hero**: Left-aligned text, right-aligned abstract visual, decorative geometric background shapes.

## Setup & Editing

### Icons
We use **FontAwesome Free 6.4.0**.
To add an icon, use the standard syntax:
```html
<i class="fa-solid fa-star"></i>
```

### Colors
Modify global colors in `styles.css` under the `:root` selector:
```css
:root {
    --primary: #3B82F6;
    --secondary: #10B981;
    /* ... */
}
```

### Layout
The project uses utility classes for grids:
-   `.grid-2`: 2 columns (responsive)
-   `.grid-3`: 3 columns (responsive)
-   `.grid-4`: 4 columns (responsive)

## Localization
The site includes basic JS-based detection for Mexico (`script.js`) which suggests switching to the Spanish version (`/es/`) if appropriate.