# Apri redesign assets

Generated with the built-in imagegen tool on 2026-10-26. No repository code, Pokémon assets, production data, or deployment was changed.

## ivory-paper-256

Source references: /tmp/trade-apri-reference/comparison.png (left warm ivory) and /tmp/trade-apri-reference/subtle-paper.png.

Prompt: seamless 256px square, extremely subtle warm ivory paper, fine barely visible organic fibers, even illumination; exclude all interface elements, logos, text, gradients, vignette, shadows and large marks.

Original imagegen output: /Users/amityaagarwal/Documents/Codex/2026-10-19/task-2/generated_images/exec-e7aa42ad-8776-4010-8ab0-93978d170b0a.png

Resampled to 256x256 with macOS sips. PNG is opaque. Mean RGB 252.23/248.74/242.22. Opposite-edge average RGB differences are 1.72 horizontal and 2.49 vertical on a 0–255 scale; subtle enough for the intended background. The generated tile is visually uniform; no literal pixel-identical edge guarantee is claimed. Prefer the lossless WebP (39,680 bytes) for production, PNG (73,556 bytes) retained.

## apri-no-smile-256

Source reference: /tmp/trade-apri-reference/apri.png, large upper gold mascot only.

Prompt: exact logo extraction/background removal, preserve silhouette/proportions/gold-charcoal colors, original upright and flopped ears, original oval eyes and white highlights; explicitly no mouth, smile, nose, eyebrows, limbs, shadow, lettering or redesign; transparent square with clear margin.

Original imagegen output: /Users/amityaagarwal/Documents/Codex/2026-10-19/task-2/generated_images/exec-06f224ca-3148-4fb8-8fad-586d3a7ce8dc.png

Resampled to 256x256 with macOS sips. Real RGBA transparency confirmed: alpha range 0–255, 29,915 fully transparent pixels. Visual inspection against the source confirms the mouthless face, ear geometry, eye arrangement and gold silhouette are preserved. This is an imagegen extraction, not a byte-exact crop; final design review should compare at intended display size. Prefer lossless WebP (26,118 bytes); PNG (51,639 bytes) retained.

Lossless WebP encodes were produced with cwebp -lossless -z 9. No manual recoloring, vector reconstruction or code-generated texture was used.

## Delivered preview assets

Startup qualification rejected the first lossless encodes. Delivered `ivory-paper.webp` is the same 256px source encoded at WebP quality 95 (3,438 bytes); `apri.webp` is the same source resized to 128px and encoded at quality 85 with full alpha quality (3,438 bytes). Total 6,876 bytes. Both were reviewed at actual display sizes after encoding. No Pokémon artwork was altered. The mascot remains an imagegen extraction, not exact original pixels.
