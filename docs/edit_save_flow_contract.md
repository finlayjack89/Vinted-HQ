# Edit Save Flow (Vinted)

This document summarizes the real Vinted web save flow captured in `docs/Edit and Save.har`,
so the app can mirror it when pushing edits to a live listing.

## Primary Save Request

- Method: `PUT`
- URL: `https://www.vinted.co.uk/api/v2/item_upload/items/{item_id}`
- Referer: `https://www.vinted.co.uk/items/{item_id}/edit`

### Required Headers (observed)

- `content-type: application/json`
- `x-csrf-token: <uuid>`
- `x-anon-id: <uuid>`
- `locale: en-GB`
- Usual browser headers (`accept`, `accept-language`, `origin`, `user-agent`, etc.)

### Request Body Shape (observed)

Root object contains:

- `item`: object containing listing fields
- `feedback_id`: null
- `push_up`: false
- `parcel`: null
- `upload_session_id`: `<uuid>`

The `item` object includes at least:

- `id`: `{item_id}`
- `currency`: `"GBP"`
- `temp_uuid`: either `""` or the same UUID as `upload_session_id` (best parity is to set it to the session UUID)
- plus editable fields like `title`, `description`, `price`, `brand_id`, `catalog_id`, `status_id`, `color_ids`, `item_attributes`, `package_size_id`, etc.

## Photos In This HAR

This specific HAR does not contain binary photo uploads (no user added/removed photos during the capture).
However it does show that Vinted uses existing `photo_ids` for suggestion calls, and the save call can succeed
without explicitly changing photos.

For implementing full photo support in the app, we rely on the known Vinted upload endpoint:

- `POST https://www.vinted.co.uk/api/v2/photos` (multipart/form-data)
- returns a photo object with an `id` which can then be referenced in `assigned_photos` / photo lists

That endpoint is already implemented in the Python bridge (`python-bridge/vinted_client.py:upload_photo`).

