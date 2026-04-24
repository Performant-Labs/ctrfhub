# Dripyard Color Management & Custom Overrides

This document captures the proper architectural approach to bypassing the automatic color generation system natively utilized by Dripyard's `dripyard_base` and its subthemes (such as `neonbyte`).

## The Dripyard 4-Layer Color Architecture

Dripyard uses a complex 4-layer color system powered by CSS `oklch()` color math to maintain WCAG 2.2 AA accessibility ratios automatically. 

1. **Theme Settings Layer**: The two anchor colors (Base Primary and Base Secondary) configured in the Drupal UI.
2. **Semantic Scale Layer**: The core engine uses the anchors to automatically extrapolate two full 10-shade scales (e.g., `--primary-100` through `--primary-1000` and `--neutral-100` through `--neutral-1000`) using `oklch` lightness interpolation. 
3. **Theme Layer**: It distributes those semantic scales into 5 built-in theme wrappers (`White, Light, Primary, Dark, Black`). These map out specific variables like `--theme-surface`, `--theme-text-color-loud`, and `--theme-border-color`.
4. **Component Layer**: Every block or menu inherits styles natively based on the overarching wrapper classes (e.g. `<footer class="site-footer theme--primary">`).

## The Pitfall: Semantic Layer Specificity Wars

The internal theme documentation implies that you should override the Layer 2 Semantic scale using `:where(:root)`. **However, this will fail in practice.**

Because Dripyard's backend actively injects the `base_primary_color` dynamically as an **inline style directly onto the `<html>` tag** (e.g., `style="--theme-setting-base-primary-color: #0000d9;"`), the inline variable possesses absolute maximum CSS specificity. Consequently, any Semantic substitutions defined inside external CSS files will inevitably lose the variable cascade when resolving specialized descendant regions (like `<footer class="site-footer theme--primary">`), and the system will forcefully revert to the internal OKLCH math engine's default bright blue.

## The Architecturally Correct Solution: Override the Component Layer

The most reliable, upgrade-proof way to bypass the dynamic `oklch()` generation while structurally retaining the layout's built-in 5-theme capability is to explicitly override the overarching region wrapper classes directly at the **Layer 4 Component Layer**.

By using descendant selectors against `html`, your custom palette fundamentally overrides both the internal OKLCH computations and the inline HTML variable assignments, natively executing your exact colors across every DOM layout segment!

### Example Configuration Snippet

Place this in your subtheme's stylesheet (`web/themes/custom/[subtheme_name]/css/base.css`):

```css
/* Custom Palette Color Component Overrides */

/* LIGHT / WHITE REGIONS (e.g., Main Page Content) */
html :where(:root),
html .theme--light, 
html .theme--white {
  --theme-surface: #F0F1F0;               
  --theme-surface-alt: #FFFFFF;           
  --theme-text-color-primary: #1B2638;    
  --theme-text-color-loud: #2D3E48;       
  --theme-text-color-medium: #555F68;     
  --theme-link-color: #F59E0B;            
  --theme-link-hover: #92600A;            
  --theme-border-color: #555F68;          
  --theme-focus-ring-color: #F59E0B;      
}

/* PRIMARY / DARK REGIONS (e.g., Site Footer, Headers) */
html .theme--primary,
html .theme--dark,
html .theme--black {
  --theme-surface: #1B2638;             /* Dark Navy Background */  
  --theme-surface-alt: #2D3E48;         /* Lighter Dark Slate Panels */
  --theme-text-color-primary: #F0F1F0;  /* Bright Text */  
  --theme-text-color-loud: #FFFFFF;     
  --theme-text-color-medium: #555F68;   /* Muted Slate Text */  
  --theme-link-color: #F59E0B;          /* Amber Links */  
  --theme-link-hover: #92600A;          
  --theme-border-color: #555F68;        
  --theme-focus-ring-color: #F59E0B;    
}
```

This single configuration structurally anchors your exact static colors securely onto the robust block rendering system Dripyard expects!
