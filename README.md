# Urban Air Quality Assistant

A GenAI-powered assistant that helps people, families and communities get through **winter smog and urban air pollution**. It reads live air quality for your location, works out what that air means **for you** (kids at home, asthma, how you commute, how you cook), and gives a practical plan of:

- **Low-emission daily routines** (when to go out, how to commute, what not to burn)
- **Indoor air-quality hacks** (windows, purifiers, DIY filters, cooking smoke)
- **Sustainable alternatives** (transit, clean cooking fuel, warmth without fires)

Every suggestion explains its **direct impact**: exposure avoided, % cleaner hours, or kg of CO₂ saved, calculated from your own inputs.

A **"Lungs buddy"** mascot reacts to the air with light, funny motion graphics. It dances in clean air, coughs, puts on an N95, then a gas mask, and finally faints dramatically (white flag included) at hazardous levels. The whole app works in **English and Hindi**.

> **Live demo:** https://dhirajkhobragade25-droid.github.io/urban-air-assistant/

---

## Chosen vertical

**Urban Air Quality Assistant (Challenge 6)**, built for the **general public**: individuals and households in smog-affected cities. The persona logic adapts to sensitive groups (children, older adults, pregnancy, asthma/lung/heart conditions) and to lifestyle (commute mode and distance, cooking fuel, purifier at home, outdoor exercise).

## How it works

```
 City / GPS ──► Open-Meteo geocoding ──► Open-Meteo Air Quality (CAMS)
                                              │  current US AQI, PM2.5, PM10, NO₂, O₃
                                              │  + 48 h hourly PM2.5 forecast
                                              ▼
 Profile ─────────────────────────► engine.js  (pure logic)
 (sensitivities, commute, cooking)     • AQI band + personal risk level
                                       • cleanest / dirtiest 2-hour window
                                       • WHO guideline multiple, CO₂ maths
                                              ▼
                                     advice.js  (27 transparent rules)
                                       • picks, prioritises, caps advice
                                       • attaches impact numbers
                                              ▼
        ┌───────────────────────────────┼──────────────────────────────┐
        ▼                               ▼                              ▼
  Plan cards (UI)               Lungs buddy mood               Ask the assistant
  4 groups, priority tags       (CSS animation)                Gemini, grounded on the
                                                               same data + plan;
                                                               offline fallback
```

### Decision logic

1. **Outdoor band.** US EPA AQI bands: Good → Hazardous.
2. **Personal risk level.** Raised **+1** for any sensitive member once AQI > 50, and **+1 more** for lung/heart conditions once AQI > 100 (capped at Hazardous). The mascot and the plan both follow this personal level, so the same air looks worse for an asthmatic household than for a healthy adult.
3. **Forecast window.** A sliding 2-hour window over the next 24 h of PM2.5 finds the cleanest and dirtiest hours. It is only recommended if it is at least 10% cleaner.
4. **Rules.** 27 small rules (in `js/advice.js`) each return a recommendation or nothing. Results are grouped into *Protect yourself / Low-emission routines / Indoor air hacks / Sustainable switches*, sorted by priority (Do now → Important → Good habit) and capped at 4 per group to stay readable.
5. **Impact.** Numbers come from the user's inputs, for example *"Swapping your 12 km each-way drive for transit today avoids about 3.4 kg of CO₂"*.

### GenAI assistant

- Uses **Google Gemini** (`generateContent`, default model alias `gemini-flash-latest`, editable).
- The prompt is **grounded**: Gemini receives the live readings, personal risk, household profile and the computed plan as structured JSON, and is told to use only that data, keep answers short, and explain the impact of each tip.
- **Prompt-injection guard:** the user question is sanitised, length-limited and wrapped in `<question>` tags that the system prompt marks as untrusted.
- **Always answers.** Without a key, or if Gemini fails (quota, network, bad key), a built-in intent matcher (English + Hindi keywords) answers from the same plan and tells the user why.

### "What if?" simulator

A slider lets anyone (including judges) try any AQI from 0 to 500 and instantly see the plan and the mascot change, even without network access.

## Project structure

```
index.html            Semantic, accessible markup + inline SVG mascot
favicon.svg
css/styles.css        Layout, AQI colours, all mascot animations (CSS only)
js/engine.js          Pure logic: AQI bands, risk, forecast window, CO₂ maths, parsing
js/advice.js          Rule engine that builds the plan
js/assistant.js       Gemini client, grounded prompts, offline answerer
js/api.js             Open-Meteo clients with timeout + 10-minute cache
js/i18n.js            English + Hindi strings and translator
js/mascot.js          Mood mapping and mascot rendering
js/app.js             UI controller (the only file that touches the DOM)
tests/*.test.js       40 unit tests (node:test, no dependencies)
```

No frameworks, no build step and no runtime dependencies. The repository is well under 1 MB.

## Assumptions

- **AQI scale:** US EPA AQI as returned by Open-Meteo (CAMS model data). It can differ from national indices such as India's CPCB AQI and from nearby monitoring stations.
- **CO₂ factors (per passenger-km, rounded):** car 0.17 kg, two-wheeler 0.05 kg, metro/bus 0.03 kg, walking/cycling 0. A commute is 2 trips a day; "transit default" means 3 days a week. These figures explain the scale of a choice; they are not an emissions audit.
- **WHO guideline:** 15 µg/m³ for 24-hour PM2.5 (WHO 2021).
- Health tips are general public-health guidance, **not medical advice**.

## Security & privacy

- **No secrets in the repo.** The Gemini key is entered by the user, kept in memory (or `sessionStorage` only if they tick "remember"), and sent **only** to Google in the `x-goog-api-key` header, never in a URL.
- **Strict Content-Security-Policy:** only self-hosted scripts/styles, network calls limited to Open-Meteo and the Gemini API, `base-uri` and `form-action` locked.
- **No `innerHTML`.** All dynamic text, including AI output, is rendered with `textContent`.
- Input validation everywhere: profile values are whitelisted, coordinates range-checked, API key and model name pattern-checked, questions sanitised and capped at 300 characters.
- Profile and last city stay in the browser's `localStorage`; nothing is sent to any server of ours, because there is none.

## Accessibility

- Semantic landmarks, headings, labelled form controls, skip link, visible focus ring, 44 px touch targets.
- AQI is never shown by colour alone: every band has a text label, and the chips meet AA contrast.
- Status updates use `role="status"`. The mascot is an SVG with a translated accessible name describing its mood.
- Animations use only `transform`/`opacity`, stop completely under `prefers-reduced-motion`, and have a **Pause animation** button (WCAG 2.2.2).
- Full Hindi UI with correct `lang` attribute switching.

## Efficiency

- Static site, about 100 KB uncompressed, zero dependencies, ES modules loaded natively.
- One geocoding and one air-quality request per search; responses cached for 10 minutes; 12 s timeouts.
- Slider and profile changes are coalesced to one render per animation frame.
- Mascot motion is pure CSS and GPU-friendly.

## Testing

```bash
npm test        # node --test, 40 tests, needs Node 20+
```

Covers AQI band edges, input validation, personal risk, forecast windows (gaps, past hours, midnight wrap), response parsing, every rule path, CO₂ maths, prompt grounding and injection handling, Gemini error mapping (key in header, not URL), API caching/timeouts/validation, translation key and placeholder parity between English and Hindi, and mascot mood mapping.

## Run locally

```bash
npm start       # python3 -m http.server 8080
# open http://localhost:8080
```

Any static file server works (ES modules need http://, not file://).

## Deploy

GitHub Pages → *Settings → Pages → Deploy from a branch → `main` / root*.

## Data sources

- Air quality and geocoding: [Open-Meteo](https://open-meteo.com/) (CAMS forecasts), free, no key.
- AI: [Google Gemini API](https://ai.google.dev/).

## License

MIT
