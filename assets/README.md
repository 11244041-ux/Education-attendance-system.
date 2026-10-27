# Login illustration

The illustration was supplied by the project owner as “Learning Together in Mozambique”. It is used as decorative artwork on the login and recovery screens. The signed-in workspace keeps its existing presentation.

The supplied PNG is 1672 × 941 pixels and 2,801,852 bytes. Optimized versions preserve its proportions and composition; only resizing and compression were applied, with no redraw or baked-in crop.

| Width | AVIF | WebP fallback |
| --- | --- | --- |
| 1100 px (619 px high) | 108,322 bytes | 164,160 bytes |
| 1672 px (941 px high) | 196,436 bytes | 299,072 bytes |

The full-resolution AVIF is approximately 93% smaller than the supplied file. The HTML picture element selects a width based on the viewport and the rendered cover size; AVIF is preferred, with WebP for browsers without AVIF support. The image has high fetch priority and needs no third-party host.

Encoding used Pillow: AVIF quality 60/speed 6 and WebP quality 82/method 6; resizing used Lanczos. The browser performs responsive cropping with `object-fit: cover`. Landscape positioning preserves people on the left; portrait/mobile positioning uses an 18% horizontal focal point. Mobile forms scroll when viewport height is reduced and retain 16 px inputs to avoid input-focus zoom on iOS.

Run `node supabase/tests/login-layout.cjs` for responsive and image-fallback checks. Set `SCREENSHOT_DIR` to a directory outside the repository to save local viewport screenshots. Simulated reduced-height checks do not replace testing with a physical mobile keyboard.
