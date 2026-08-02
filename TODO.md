# Integration Hub Update

## What was implemented
- Settings → "Entegrasyonlar" section now shows 6 category cards
  (Bilgi & Üretkenlik, Sağlık & Wearable, AI Coach, Otomasyonlar,
  Sosyal Sorumluluk, Cihaz & Ortam)
- Tapping a category opens a modal-based detail view with that
  category's integration items
- Existing Webhook Yönetimi flow preserved under Otomasyonlar
  (now reachable in 2 taps instead of 1)
- Centralized typed data in frontend/constants/integrations.ts
- Three new reusable components under frontend/components/

## Files changed
- frontend/constants/integrations.ts (new)
- frontend/components/IntegrationCategoryCard.tsx (new)
- frontend/components/IntegrationItemCard.tsx (new)
- frontend/components/IntegrationStatusBadge.tsx (new)
- frontend/app/tabs/settings.tsx (modified — Entegrasyonlar section
  only; webhook Modal/handlers untouched)

## Files NOT changed (sanity)
- frontend/utils/api.ts (webhookAPI)
- Export, Takip, Veri ve Gizlilik, Hakkında, Özellikler sections
- Webhook Modal JSX and handlers
- frontend/app/tabs/_layout.tsx and navigation config

## UI-only integrations (status: "Yakında")
All items except `automation/webhook` are UI stubs. No backend
calls, no fake OAuth, no false "connected" states.

## Webhook preservation note
The existing webhook Modal in settings.tsx is unchanged. Entry path:
Settings → Entegrasyonlar → Otomasyonlar → Webhook Yönetimi.
The handoff uses a 280ms delay between modal close and webhook
modal open to avoid iOS animation overlap.

## Known polish items (deferred)
- Category modal header reuses `modalDescription` style; its
  `marginBottom: 20` may need a header-specific variant if visual
  QA shows excess gap.
- `categoryDetailScroll` uses `flex: 1`; verify on small screens
  (iPhone SE / short Androids) that the item list scrolls cleanly
  inside the modal sheet.

## Next real-integration steps
- Notion OAuth + database row sync
- Obsidian Markdown export adapter
- Google / Apple Calendar two-way sync
- Apple Health / Health Connect read pipelines
- AI Coach analysis service (trend + drop detection on habit logs)
- n8n / Zapier / Make event templates
  (habit.completed, streak.broken, goal.reached)
- Telegram bot notifier
- Discord webhook notifier
- Spotify playlist trigger on focus habit start
- Focus mode + Smart Home (HomeKit / Google Home) adapters
