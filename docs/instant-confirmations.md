# Instant confirmation emails (for when the .com is live)

Branch: `instant-confirmations`. Kept separate from `staging`/`main` on purpose.

When a client submits the booking form, Netlify runs `netlify/functions/submission-created.mjs`
within seconds and emails them a "Request received" summary (service, date, guests, area,
call/Meet request, next steps, link to booking terms). Review-form submitters get a short thank-you.
Netlify only triggers it for submissions that pass its spam filter.

It stays switched off until the variables below exist, so merging it early sends nothing.

## Turn it on
1. Buy the domain (for example blaiseculinarycreations.com) and connect it to the Netlify site.
2. Create a free account at resend.com, add the domain, and add the DNS records Resend shows
   (in Netlify: Domains → your domain → DNS settings). Wait until Resend says "Verified".
3. In Resend, create an API key with "Sending access".
4. In Netlify → Environment variables, add (mark the key as a secret):
   - `CONFIRM_EMAILS` = `on`
   - `RESEND_API_KEY` = the key from step 3
   - `CONFIRM_FROM` = `Blaise Culinary Creations <hello@blaiseculinarycreations.com>`
   - `CONFIRM_REPLY_TO` = `blaiseculinarycreations@gmail.com` (optional; replies land in Gmail)
   - `CONFIRM_BCC` = `blaiseculinarycreations@gmail.com` (optional; a copy of every email)
5. Merge this branch into `main` (one production deploy), then submit a test booking with your
   own email.

To pause it later, set `CONFIRM_EMAILS` to `off` (takes effect on the next deploy).
Also update `SITE` at the top of the function to the new domain.
