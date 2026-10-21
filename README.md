# Cardfile

An iPhone app for business cards. Take a photo of a card and Cardfile reads it,
fills in the name, job title, company, phone numbers, emails, website and address,
and keeps the photo with the entry. Group cards with your own tags (Furniture,
Restaurants, Healthcare, …), search everything, and call, text, email or add a
card to Contacts with one tap.

It's an installable web app: you add it to your Home Screen from Safari and it
runs full screen, works offline, and keeps everything on the phone. The text
reading happens on the phone too (Tesseract, compiled to WebAssembly), so card
photos never leave it.

Needs iOS 16.4 or later.

---

## Put it on your iPhone (free, about 10 minutes)

The app has to be served over HTTPS once so Safari can install it. GitHub Pages
does that for free.

1. On your iPhone, open that link **in Safari**, tap the **Share** button, then
   **Add to Home Screen**.
2. Open Cardfile from the Home Screen icon. The first scan downloads the text
   reader (about 7 MB); after that it works offline.

## Using it

- **Scan card** → *Take photo*. Fill the frame with the card, in good light. The
  fields fill in a second or two later. Check them and tap **Save**.
- Something landed in the wrong field? Scroll to **Text on the card** and tap a
  line to put it where it belongs.
- If nothing was read, the photo is probably sideways: tap **Rotate**.
- **Tags**: tap tags in the editor to add them; *New tag* makes one. On the main
  list, tap a tag to filter, or switch to **By tag** to see cards grouped.
  The tag button at the top right lets you rename, recolour and delete tags.
- **Search** looks through names, companies, titles, numbers, emails, addresses,
  notes, tags, and every word that was on the card.
- On a card: **Call**, **Text**, **Email**, **Website**, tap the address to open
  Maps, tap the photo to see it full screen.
- **Contacts** builds a contact card (with the card photo) and opens the iOS share
  sheet. Pick *Contacts* if it's offered; otherwise pick *Save to Files*, then open
  the file in Files and tap *Create New Contact*.

### Backups (please read)

Cards are stored only on this iPhone. **If you delete Cardfile from your Home
Screen, its cards are deleted too.** Use the tag button → **Save backup** now and
then and keep the file in iCloud Drive. **Restore backup** brings everything back,
photos included.

## Known limits

- The reader handles normal printed cards well. Script fonts, tiny print, vertical
  layouts, glossy glare and low light make it guess more. You can always fix a
  field by hand or with the tap-a-line list.
- English only for now.
- The Contacts button relies on the iOS share sheet, which differs a little between
  iOS versions. The *Save to Files* route always works.

## Changing the app

It's plain HTML, CSS and JavaScript with no build step.

```
app/
  index.html            page shell
  css/app.css           all styling (light and dark mode)
  js/app.js             screens, navigation, buttons
  js/parser.js          turns recognised text into name / phone / email / ...
  js/ocr.js             runs the text reader
  js/image.js           photo resizing, thumbnail crop, OCR clean-up
  js/db.js              on-phone storage (IndexedDB) and backups
  js/vcard.js           contact file for "Add to Contacts"
  sw.js                 offline support
  vendor/tesseract/     the text reader (WebAssembly) and English data
dev/                    tests and test cards (not needed on the phone)
```

Run it on your PC: `python -m http.server 8000 -d app`, then open
`http://localhost:8000`. (Your phone can open `http://YOUR-PC-IP:8000` on the same
Wi-Fi to try the camera, but offline mode and Add to Home Screen only work over
HTTPS, i.e. the GitHub Pages link.)

After changing anything, bump `VERSION` in `sw.js` (`'v1'` → `'v2'`) and upload
the changed files to GitHub. The installed app picks up the update the next time
it's opened with a connection.

Tests (need Node.js): `npm install`, then

- `node dev/test_parser.mjs`: parser checks on real OCR output and messy samples
- `python dev/make_cards.py` makes the test card photos; `node dev/ocr_node.mjs` re-reads them
- `npx playwright install chromium`, then `node dev/e2e.mjs`: full run in a phone-sized browser

The reader is [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0);
its licence files are in `app/vendor/tesseract/`.
