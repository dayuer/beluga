import type { PropsWithChildren } from 'react';

/**
 * Static-rendering HTML shell (Expo's `+html.tsx`). This build uses `web.output: "single"`, where
 * Expo's exporter reads `public/index.html` instead; that file carries the same viewport. Keep this
 * one for the day P1 switches to static rendering.
 *
 * The web shell: a phone viewport that respects the notch (viewport-fit=cover) and lets the
 * on-screen keyboard resize the content where the platform supports it
 * (interactive-widget=resizes-content). iOS Safari ignores the latter; lib/viewport.ts is the
 * fallback. No `user-scalable=no`: zooming stays available.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#FFFFFF" />
        <title>Synon Studio</title>
        <style>{`
          html, body, #root { height: 100%; margin: 0; background: #F6F6F7; }\n          #root { display: flex; flex: 1; }
          body { overflow: hidden; overscroll-behavior-y: none; }
          * { -webkit-tap-highlight-color: transparent; }
          button:focus-visible, [role='button']:focus-visible, input:focus-visible, textarea:focus-visible {
            outline: 2px solid #2f64d0 !important;
            outline-offset: 2px;
          }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
              scroll-behavior: auto !important;
            }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
