# sleep-tracker-27

Private 2-parent sleep & wake tracker PWA powered by **Precious Little Sleep** (`2nd Edition`) rules, forgiving gap interpolation, `1D/3D/7D/30D` raster graphs, and offline-first Firebase sync (`sleep-tracker-27`).

## Local Commands (mise)

```bash
# Run dev server
mise run dev

# Run full validation suite (lint, check, test)
mise run validate

# Run individual checks
mise run lint
mise run format
mise run check
mise run test

# Build and preview production bundle (dist/)
mise run build
mise run start
```

> **Note:** Tasks run through `mise` using the pinned `bun`, `biome`, and `firebase` tools in `./mise.toml`. The archived v1 UI is served at `/v1`.

## Previewing Before Jan 1, 2027

1. Run `mise run dev` and open the app in your browser (`/v1` for the v1 UI).
2. Tap **Load 14-Day Sample Data** (on the home banner or inside Settings) to preview `1D/3D/7D/30D` sleep raster charts, hatched interpolated missed taps, Nap 1/2/3 averages, and live PLS Coach alerts.
3. Use **Reset to Clean Jan 1, 2027 Slate** in Settings when you're ready for real tracking.

## Deploying to Firebase Hosting & Publishing Rules

1. Authenticate Firebase CLI with the owner account (`blake@blakerutledge.com`):

    ```bash
    # If currently logged into another Google account in Firebase CLI:
    firebase login:add
    # Or switch completely via:
    firebase logout && firebase login
    ```
2. Build and deploy both Hosting (`https://sleep-tracker-27.web.app`) and `firestore.rules`:

    ```bash
    mise run deploy
    ```
3. **Custom Domain Note:** If you ever attach a custom hosting domain, add it under **Firebase Console → Authentication → Settings → Authorized domains** so Google Sign-In works there too. (`sleep-tracker-27.web.app` and `localhost` are authorized by default.)
4. **Install on iPhone:** Open `https://sleep-tracker-27.web.app` in Safari → Share → **Add to Home Screen**.
