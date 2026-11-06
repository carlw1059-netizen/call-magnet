# Contract: Save Buttons

## Interface

`saveButtons()` in `assets/js/middle-man-admin.js`

Reads the `#mmaBtnBuilder` DOM, builds a button array, and writes it to `clients.middle_man_buttons` via Supabase UPDATE.

## Button object shape (after this feature)

All existing fields unchanged. New optional field:

```json
{
	"id": "string",
	"label": "string",
	"sort_order": 1,
	"enabled": true,
	"color": "#00D4FF",
	"animate": true,
	"sparkles": false,
	"effect": "",
	"url": "",
	"emoji": "🎉",
	"push_title": "",
	"push_message": "",
	"infopack_url": ""
}
```

## Rules

- `infopack_url` always written (even empty string)
- Buttons with empty labels are skipped (unchanged)
- UPDATE uses `.select('id')` to verify a row was actually updated
- DOM read: `(row.querySelector('.mma-btn-infopack') || { value: '' }).value.trim()`
