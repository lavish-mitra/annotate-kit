# annotate-kit

A drop-in **in-app annotation / visual-feedback overlay** for React apps.

Pin and draw directly on your live site, capture element context + screenshots + console errors, then
export one clean markdown prompt to hand your developer (or paste to Claude). Backend-agnostic: the whole
UI runs on a tiny **storage adapter**, and adapters for **Supabase** and **Firebase** ship in the box.

Built once, reused across every project — no more copy-paste-and-rewire.

- 📌 Pin + box/arrow/circle/freehand marks, colours, priority, type, status
- 🖼️ Element screenshots + full-page/viewport capture
- 🐛 Auto-captured browser/OS/viewport + recent console/JS errors → reproducible bug reports
- 👥 Per-user visibility (private/public), replies, author attribution
- 🔑 Global "visible to all users" toggle (admin) — else admin-only
- 🎨 Self-contained styles — one CSS import, works with or without Tailwind in the host app
- 🔌 Same component, any backend, via a 9-method adapter

---

## Install

```bash
npm install github:Afl-work/annotate-kit
```

> Ships prebuilt (`dist/` is committed), so no build step is needed on install.
> Peer deps: `react` and `react-dom` (already in your app).

Import the stylesheet once (e.g. in your root):

```ts
import 'annotate-kit/styles.css'
```

---

## Quick start — Supabase

**1. Apply the backend** (once): run [`backend/supabase/migration.sql`](backend/supabase/migration.sql)
via `supabase db push` or the SQL editor. It creates the table, a global toggle, a private
`annotations` bucket, and RLS policies safe for the anon key.

**2. Mark your admins**: in Supabase Auth, give admin users
`app_metadata.role = "admin"` (or `app_metadata.annotate_admin = true`).

**3. Mount it:**

```tsx
import { Annotate } from 'annotate-kit'
import { createSupabaseAdapter } from 'annotate-kit/supabase'
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'   // your existing client
import 'annotate-kit/styles.css'

export function AnnotateMount() {
  const adapter = useMemo(() => createSupabaseAdapter({ client: supabase }), [])
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return <Annotate adapter={adapter} route={pathname} onNavigate={navigate} />
}
```

Render `<AnnotateMount />` once, near the app root (inside your Router + Auth providers).

---

## Quick start — Firebase

**1. Apply the rules** (once): merge [`backend/firebase/firestore.rules`](backend/firebase/firestore.rules)
and [`backend/firebase/storage.rules`](backend/firebase/storage.rules) into your project's rules and deploy:

```bash
firebase deploy --only firestore:rules,storage
```

**2. Mark your admins** via a custom claim (Admin SDK):

```js
await admin.auth().setCustomUserClaims(uid, { admin: true })
```

**3. Mount it:**

```tsx
import { Annotate } from 'annotate-kit'
import { createFirebaseAdapter } from 'annotate-kit/firebase'
import { useMemo } from 'react'
import { db, storage, auth } from './lib/firebase'   // your getFirestore / getStorage / getAuth
import 'annotate-kit/styles.css'

export function AnnotateMount() {
  const adapter = useMemo(() => createFirebaseAdapter({ firestore: db, storage, auth }), [])
  return <Annotate adapter={adapter} route={window.location.pathname} />
}
```

(If you use a router, pass `route={pathname}` and `onNavigate={navigate}` as in the Supabase example.)

---

## `<Annotate>` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `adapter` | `StorageAdapter` | — | **Required.** From `annotate-kit/supabase`, `annotate-kit/firebase`, or your own. |
| `route` | `string` | `window.location.pathname` | Pass your router's pathname so marks are page-aware in an SPA. |
| `onNavigate` | `(path) => void` | full-page load | Pass your router's `navigate` for smooth cross-page "find on page". |
| `user` | `{ email; name; role }` | from `adapter.getAccess().me` | Override author attribution. |
| `onToast` | `(kind, msg) => void` | built-in mini-toast | Hook into your app's notifications. |
| `pollMs` | `number` | `15000` | Refresh cadence while the tool/panel is open. |

The tool only renders for users who may use it (the global toggle is on, or they're admin), so it's safe
to mount unconditionally.

---

## Write your own adapter

Implement 9 methods against any store and the whole UI just works:

```ts
import type { StorageAdapter } from 'annotate-kit'

const myAdapter: StorageAdapter = {
  getAccess,        // who is looking + what they may do
  setAccess,        // flip the global toggle (admin)
  list,             // all visible marks, with screenshot_url resolved
  save,             // persist a new mark → { id }
  update,           // patch status/note/type/priority by id
  remove,           // delete a mark (+ its screenshot)
  addReply,         // append a reply
  clearResolved,    // delete done/dismissed
  uploadScreenshot, // File → { path }
}
```

See [`src/adapter.ts`](src/adapter.ts) for the exact contract.

---

## Sending feedback to a developer

Open the dock → mark things → **Send**. You get a structured markdown prompt (grouped by page, ordered by
priority, each item naming the exact element, request, environment and console). Copy it into your dev chat
or Claude. As items get built, flip them to **Done** in the panel.

`buildClaudePrompt(items)` is also exported if you want to generate that markdown yourself.

---

## Updating the kit

`git pull` inside this repo, then in each consuming project: `npm update annotate-kit`.
To rebuild after editing source: `npm install && npm run build` (rebuilds `dist/` JS + CSS), commit, push.

## License

MIT.
