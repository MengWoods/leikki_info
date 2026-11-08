import { convert } from 'html-to-text';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const feeds = [
  { id: 'espoo', name: 'City of Espoo', base: 'https://api.espoo.fi/events/v1/' },
  { id: 'helsinki', name: 'Linked Events (Helsinki, Espoo, Vantaa)', base: 'https://api.hel.fi/linkedevents/v1/', params: { division: 'espoo,helsinki,vantaa' } }
];
export const cities = ['espoo', 'helsinki', 'vantaa'];
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' });
export function localDate(value) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function activityWindow(now = new Date()) {
  const date = new Date(`${localDate(now)}T12:00:00Z`);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + (8 - (end.getUTCDay() || 7)) + 7);
  const nextWeekStart = new Date(end);
  nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() - 7);
  const count = Math.round((end - date) / 86400000);
  const days = Array.from({ length: count }, (_, offset) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
  return { start: days[0], end: end.toISOString().slice(0, 10), nextWeekStart: nextWeekStart.toISOString().slice(0, 10), days };
}
const plain = value => convert(value || '', { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] }).replace(/\s+/g, ' ').trim();
const multilingual = value => Object.fromEntries(['en', 'fi'].map(language => [language, plain(value?.[language])]).filter(([, text]) => text));
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
const feeText = /(sisäänpääsymaksu|pääsymaksu|admission fee|entrance fee|museon pääsylip|museum ticket|pääsylipu)/i;
const freeText = /(vapaa pääsy|free admission|free entry|maksuton|free of charge)/i;
export function priceOf(event, text) {
  const offers = event.offers || [];
  const pick = field => Object.fromEntries(['en', 'fi'].map(language => [language, offers.map(offer => plain(offer[field]?.[language] || offer[field]?.fi || offer[field]?.en)).filter(Boolean).join(' / ')]).filter(([, value]) => value));
  const url = offers.map(offer => safeUrl(offer.info_url?.fi || offer.info_url?.en || Object.values(offer.info_url || {})[0])).find(Boolean) || null;
  if (offers.length && offers.every(offer => offer.is_free === true)) {
    if (feeText.test(text) && !freeText.test(text)) return { status: 'paid', text: {}, url, note: 'admission' };
    return { status: 'free', text: {}, url: null };
  }
  if (offers.some(offer => offer.is_free === false)) return { status: 'paid', text: pick('price'), url };
  return { status: 'unknown', text: {}, url: null };
}
export function scoreActivity(activity) {
  const price = activity.price?.status ?? 'free';
  const reasons = [];
  if (price === 'free') reasons.push({ key: 'freeSource', points: 30 });
  else if (price === 'paid' && Object.keys(activity.price.text || {}).length) reasons.push({ key: 'pricedOffer', points: 20 });
  reasons.push({ key: activity.category, points: { movement: 30, play: 25, creative: 20, quiet: 15 }[activity.category] });
  if (activity.ages.confirmed) reasons.push({ key: 'knownAge', points: 15 });
  const minutes = (new Date(activity.end) - new Date(activity.start)) / 60000;
  if (activity.end && minutes >= 30 && minutes <= 120) reasons.push({ key: 'duration', points: 10 });
  if (activity.dropIn) reasons.push({ key: 'dropIn', points: 10 });
  if (Object.values(activity.venue).some(Boolean)) reasons.push({ key: 'knownVenue', points: 5 });
  return { value: reasons.reduce((total, reason) => total + reason.points, 0), reasons };
}
export function normalize(event, feed, week, checkedAt) {
  if (!event.start_time || event.deleted || event.event_status !== 'EventScheduled' || event.super_event_type || event.sub_events?.length) return null;
  const date = localDate(event.start_time);
  if (!week.days.includes(date)) return null;
  const title = multilingual(event.name);
  const description = multilingual(event.short_description || event.description);
  const fullText = plain(Object.values(event.description || {}).join(' '));
  const text = `${Object.values(title).join(' ')} ${fullText}`.toLowerCase();
  const titleText = Object.values(title).join(' ');
  const babyOnly = /(vauva|vauvo|babies|baby|infant)/i.test(titleText) && !/(taapero|toddler|sisar|sibling|perhe|family)/i.test(titleText);
  if (/(senior|seniori|senpp|ikäihmi|eläkeläi|older adults)/i.test(titleText) && !/(perhe|family|families|laps|children|kids)/i.test(titleText)) return null;
  if (/(nuorille|nuorten|teenagers|teens|homework club|läksykerho)/i.test(titleText)) return null;
  const grade = titleText.match(/(?:([1-9])(?:st|nd|rd|th)?\s*[-\u2013]\s*[1-9](?:st|nd|rd|th)?\s*(?:graders|grades)|grades?\s*([1-9])|([1-9])\.?\s*[-\u2013]\s*[1-9]\.?\s*[- ]?luokk)/i);
  const place = event.location || {};
  const city = place.divisions?.find(division => division.type === 'muni')?.ocd_id?.split(':').at(-1);
  if (!cities.includes(city)) return null;
  if (/(vain päiväk|päiväkodeille|daycare cent(?:er|re)s|school groups only|vapaaehtoisten koulutus|volunteer training|aikuisille|for adults)/i.test(text)) return null;
  const explicitAges = text.match(/(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\s*[- ]?(?:vuotia|year[- ]olds?|years? old)/i);
  const gradeMinimum = grade ? Number(grade.slice(1).find(Boolean)) + 6 : null;
  const minimum = event.audience_min_age == null ? (explicitAges ? Number(explicitAges[1]) : babyOnly ? 0 : gradeMinimum) : Number(event.audience_min_age);
  const maximum = event.audience_max_age == null ? (explicitAges ? Number(explicitAges[2]) : babyOnly ? 1 : null) : Number(event.audience_max_age);
  if ((minimum !== null && minimum > 8) || (maximum !== null && maximum < 0)) return null;
  const family = /(perhe|family|families|laps|children|kids|leikki|playground|taapero|toddler|vauva|vauvo|baby|babies|satutuokio|story.?time)/i.test(text);
  if (!family && minimum === null && maximum === null) return null;
  const category = /(perhepeuhu|perheliikunta|jumppa|dance|tanssi|liikunta|movement|exercise|temppurata|obstacle|liikettä)/i.test(text) ? 'movement'
    : /(leikkipuisto|asukaspuisto|playground|leikki|perheaamu|perhekahvila|family caf|family morning|play session)/i.test(text) ? 'play'
    : /(satutuokio|story.?time|reading|lukutuokio)/i.test(text) ? 'quiet' : 'creative';
  const environment = /(ulkona|outdoors|outdoor activity)/i.test(text) ? 'outdoor' : /(sisätil|indoors|indoor activity)/i.test(text) ? 'indoor' : 'unknown';
  const sourceUrl = feed.id === 'espoo' ? `https://www.espoo.fi/en/events/${event.id}` : `https://tapahtumat.hel.fi/en/events/${event.id}`;
  const images = event.images || [];
  const image = images.find(item => safeUrl(item.url) && item.photographer_name && ['event_only', 'cc_by'].includes(item.license));
  const activity = {
    id: event.id, city, date, start: event.start_time, end: event.end_time,
    title, description, category, environment, price: priceOf(event, text),
    dropIn: /(ei (?:tarvitse )?(?:ennakko)?ilmoittautumis|ilman (?:ennakko)?ilmoittautumis|no (?:advance )?(?:registration|booking)|without (?:advance )?(?:registration|booking))/i.test(text),
    ages: { min: minimum, max: maximum, confirmed: minimum !== null || maximum !== null || event.no_age_limit === true },
    venue: multilingual(place.name), address: multilingual(place.street_address),
    languages: (event.in_language || []).map(item => item['@id']?.match(/language\/([^/]+)/)?.[1]).filter(Boolean),
    registrationUrl: safeUrl(event.event_registration_link || event.registration?.enrolment_url),
    infoUrls: Object.fromEntries(Object.entries(event.info_url || {}).map(([language, url]) => [language, safeUrl(url)]).filter(([, url]) => url)),
    sourceUrls: { en: sourceUrl, fi: sourceUrl.replace('/en/', '/fi/') },
    source: feed.name, checkedAt,
    image: image ? { url: image.url, credit: `${image.photographer_name} / ${feed.name}`, license: image.license } : null
  };
  return { ...activity, score: scoreActivity(activity) };
}
export function deduplicate(events) {
  const found = new Map();
  for (const event of events) {
    const key = `${event.start}|${event.city}|${event.title.fi || event.title.en}|${event.venue.fi || event.venue.en}`.toLowerCase();
    if (!found.has(key)) found.set(key, event);
  }
  return [...found.values()].sort((first, second) => first.date.localeCompare(second.date)
    || first.start.localeCompare(second.start));
}
async function collect(feed, week, checkedAt) {
  const first = new URL('event/', feed.base);
  first.search = new URLSearchParams({ start: week.start, end: week.end, include: 'location', page_size: '100', format: 'json', ...feed.params });
  let next = first.href;
  const activities = [];
  let pages = 0;
  while (next) {
    if (++pages > 100) throw new Error('Pagination exceeded safe limit');
    const response = await fetch(next, { signal: AbortSignal.timeout(45000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Unexpected event response');
    for (const event of payload.data) {
      const activity = normalize(event, feed, week, checkedAt);
      if (activity) activities.push(activity);
    }
    if (payload.meta?.next) {
      const page = new URL(payload.meta.next);
      const canonical = new URL('event/', feed.base);
      canonical.search = page.search;
      next = canonical.href;
    } else next = null;
  }
  return { activities, pages };
}
export async function update(now = new Date()) {
  const week = activityWindow(now);
  const checkedAt = now.toISOString();
  const target = new URL('../data/activities.json', import.meta.url);
  let previous = { activities: [], sources: [] };
  try { previous = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const activities = [];
  const sources = [];
  for (const feed of feeds) {
    try {
      const result = await collect(feed, week, checkedAt);
      activities.push(...result.activities);
      sources.push({ id: feed.id, name: feed.name, url: feed.base, status: 'ok', checkedAt, count: result.activities.length });
      console.log(`${feed.name}: ${result.activities.length} activities (${result.pages} pages)`);
    } catch (error) {
      const retained = previous.schemaVersion === 3 ? previous.activities.filter(activity => activity.source === feed.name && week.days.includes(activity.date)).map(activity => ({ ...activity, stale: true })) : [];
      activities.push(...retained);
      sources.push({ id: feed.id, name: feed.name, url: feed.base, status: 'failed', checkedAt: previous.sources.find(source => source.id === feed.id)?.checkedAt || null, error: error.message, count: retained.length });
      console.error(`${feed.name}: ${error.message}`);
    }
  }
  if (sources.every(source => source.status === 'failed')) throw new Error('All feeds failed; previous snapshot was left unchanged');
  const payload = { schemaVersion: 3, generatedAt: checkedAt, week, sources, activities: deduplicate(activities) };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const temporary = new URL('../data/activities.json.tmp', import.meta.url);
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporary, target);
  console.log(`Saved ${payload.activities.length} activities for ${week.start} to ${week.days.at(-1)}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await update(process.env.NOW ? new Date(process.env.NOW) : new Date());
}
