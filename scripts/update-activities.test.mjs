import test from 'node:test';
import assert from 'node:assert/strict';
import { activityWindow, localDate, normalize, deduplicate, safeUrl, scoreActivity, feeds } from './update-activities.mjs';
const week = activityWindow(new Date('2026-11-08T10:00:00Z'));
const event = {
  id: 'espooevents:test', name: { en: 'Family play', fi: 'Perheleikki' },
  description: { en: '<p>Free play for children and families.</p>' },
  start_time: '2026-11-09T08:00:00Z', end_time: '2026-11-09T09:00:00Z',
  event_status: 'EventScheduled', offers: [{ is_free: true }],
  location: { name: { en: 'Library' }, divisions: [{ type: 'muni', ocd_id: 'ocd-division/country:fi/kunta:espoo' }] }
};
const result = changes => normalize({ ...event, ...changes }, feeds[0], week, '2026-11-08T10:00:00Z');
test('collects today through the end of next week on every weekday', () => {
  assert.equal(week.start, '2026-11-08');
  assert.equal(week.days.length, 8);
  assert.equal(week.days.at(-1), '2026-11-15');
  for (let offset = 0; offset < 7; offset++) {
    const now = new Date(`2026-11-${String(9 + offset).padStart(2, '0')}T10:00:00Z`);
    const window = activityWindow(now);
    assert.equal(window.start, localDate(now));
    assert.equal(window.nextWeekStart, '2026-11-16');
    assert.equal(window.end, '2026-11-23');
    assert.ok(window.days.length >= 8 && window.days.length <= 14);
  }
  assert.equal(activityWindow(new Date('2026-12-27T10:00:00Z')).end, '2027-01-04');
  assert.equal(activityWindow(new Date('2026-03-29T10:00:00Z')).nextWeekStart, '2026-03-30');
  assert.equal(localDate('2026-11-08T23:30:00Z'), '2026-11-09');
});
test('classifies free, paid and unknown prices', () => {
  assert.equal(result({}).price.status, 'free');
  assert.equal(result({ offers: [] }).price.status, 'unknown');
  for (const offers of [[{ is_free: false }], [{ is_free: true }, { is_free: false }]]) assert.equal(result({ offers }).price.status, 'paid');
  const paid = result({ offers: [{ is_free: false, price: { fi: '12 €' }, info_url: { fi: 'https://example.com/tickets' } }] });
  assert.deepEqual(paid.price, { status: 'paid', text: { en: '12 €', fi: '12 €' }, url: 'https://example.com/tickets' });
  assert.ok(paid.score.reasons.some(reason => reason.key === 'pricedOffer'));
  const admission = result({ description: { en: 'Family workshop included in the museum ticket. Children play.' } });
  assert.equal(admission.price.status, 'paid');
  assert.equal(admission.price.note, 'admission');
  assert.ok(result({}).score.value > paid.score.value);
});
test('excludes cancelled, recurring containers, wrong dates and age ranges', () => {
  for (const change of [{ event_status: 'EventCancelled' }, { super_event_type: 'recurring' }, { sub_events: [{}] }, { start_time: '2026-11-16T08:00:00Z' }, { audience_min_age: 9 }]) assert.equal(result(change), null);
  assert.ok(result({ audience_min_age: 3, audience_max_age: 5 }));
  assert.equal(result({}).ages.confirmed, false);
});
test('excludes school-only events and locations outside the chosen region', () => {
  assert.equal(result({ description: { en: 'Family theatre for daycare centers' } }), null);
  assert.equal(result({ name: { en: 'Saunalahti seniors evening' } }), null);
  assert.ok(result({ name: { en: 'Seniors and children play together' } }));
  assert.equal(result({ location: { divisions: [{ type: 'muni', ocd_id: 'ocd-division/country:fi/kunta:turku' }] } }), null);
});
test('includes infant sessions with a bounded baby age group', () => {
  assert.deepEqual(result({ name: { fi: 'Vauvojen aamut' } }).ages, { min: 0, max: 1, confirmed: true });
  assert.ok(result({ name: { en: 'Baby morning' } }));
  assert.ok(result({ name: { fi: 'Vauvat ja taaperot' } }));
  assert.equal(result({ name: { fi: 'Temppurata pienille' } }).category, 'movement');
});
test('excludes school-age clubs and respects explicit description age ranges', () => {
  assert.equal(result({ name: { en: 'Manga and anime hobby for 3rd-6th graders' } }), null);
  assert.equal(result({ name: { fi: 'Kerho 3.-6.-luokkalaisille' } }), null);
  assert.ok(result({ description: { fi: 'Leikki 7-12-vuotiaille lapsille.' } }));
  assert.equal(result({ description: { fi: 'Leikki 9-12-vuotiaille lapsille.' } }), null);
  const activity = result({ description: { en: 'Free family play for 3-5 year-olds.' } });
  assert.deepEqual(activity.ages, { min: 3, max: 5, confirmed: true });
});
test('includes Espoo, Helsinki and Vantaa by municipality', () => {
  for (const city of ['espoo', 'helsinki', 'vantaa']) assert.equal(result({ location: { divisions: [{ type: 'muni', ocd_id: `ocd-division/country:fi/kunta:${city}` }] } }).city, city);
  assert.equal(result({ location: { divisions: [{ type: 'muni', ocd_id: 'ocd-division/country:fi/kunta:kauniainen' }] } }), null);
  assert.equal(result({}).areas, undefined);
});
test('scores are bounded and reward evidenced play, age and practical details', () => {
  const activity = result({ audience_min_age: 0, audience_max_age: 8, description: { en: 'Family exercise, no registration.' } });
  assert.equal(activity.score.value, 100);
  assert.equal(activity.dropIn, true);
  const quiet = scoreActivity({ ...activity, category: 'quiet', dropIn: false, ages: { confirmed: false } });
  assert.ok(quiet.value < activity.score.value);
  assert.ok(quiet.reasons.every(reason => reason.points > 0));
});
test('keeps official bilingual content, strips markup and rejects dangerous links', () => {
  const activity = result({ name: { fi: '<b>Perheleikki &amp; taide</b>' } });
  assert.equal(activity.title.fi, 'Perheleikki & taide');
  assert.equal(activity.title.en, undefined);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(deduplicate([activity, activity]).length, 1);
  assert.match(activity.sourceUrls.fi, /espoo\.fi\/fi\/events\//);
});
