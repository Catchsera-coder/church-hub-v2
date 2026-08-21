import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { currentOrg } from '../settings/routes.js';

/**
 * Address autocomplete — NO AI. Uses Azure Maps if a key is configured in
 * Settings → Messaging (best quality), otherwise the free Photon (OpenStreetMap)
 * service which needs no key. Proxied server-side to avoid CORS and keep any key
 * secret. Returns normalized address parts the forms can auto-fill. Never throws
 * a form-breaking error — a geo hiccup just yields no suggestions.
 */
export const geoRouter = Router();
geoRouter.use(authenticate);

type Suggestion = { label: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string };

geoRouter.get('/autocomplete', asyncHandler(async (req, res) => {
  const { q, country } = z.object({
    q: z.string().trim().min(3).max(120),
    country: z.string().trim().max(2).optional(), // optional ISO-2 bias
  }).parse(req.query);

  const org = await currentOrg();
  const key = (org.messaging as { azureMapsKey?: string } | undefined)?.azureMapsKey;

  try {
    let data: Suggestion[] = [];
    if (key) {
      const cc = country ? `&countrySet=${encodeURIComponent(country.toUpperCase())}` : '';
      const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&subscription-key=${encodeURIComponent(key)}&typeahead=true&limit=6${cc}&query=${encodeURIComponent(q)}`;
      const j = await (await fetch(url)).json() as { results?: Array<{ address?: Record<string, string> }> };
      data = (j.results ?? []).map((it) => {
        const a = it.address ?? {};
        return {
          label: a.freeformAddress ?? '',
          line1: [a.streetNumber, a.streetName].filter(Boolean).join(' '),
          line2: '',
          city: a.municipality ?? a.municipalitySubdivision ?? a.localName ?? '',
          region: a.countrySubdivision ?? '',
          postalCode: a.postalCode ?? '',
          country: a.country ?? '',
        };
      });
    } else {
      const url = `https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}`;
      const j = await (await fetch(url, { headers: { 'User-Agent': 'church-hub/1.0' } })).json() as { features?: Array<{ properties?: Record<string, string> }> };
      data = (j.features ?? []).map((ft) => {
        const p = ft.properties ?? {};
        const line1 = [p.housenumber, p.street ?? p.name].filter(Boolean).join(' ');
        const city = p.city ?? p.town ?? p.village ?? p.county ?? '';
        const label = [line1 || p.name, city, p.state, p.country].filter(Boolean).join(', ');
        return { label, line1, line2: '', city, region: p.state ?? '', postalCode: p.postcode ?? '', country: p.country ?? '' };
      }).filter((s) => s.label);
    }
    res.json({ data });
  } catch {
    res.json({ data: [] });
  }
}));
