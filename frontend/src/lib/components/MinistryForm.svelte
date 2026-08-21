<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { resolveStreamLink } from '$lib/stream.js';

  let { initial = null, id = null, redirect = true, onsaved = null }:
    { initial?: any; id?: number | null; redirect?: boolean; onsaved?: (() => void) | null } = $props();

  let form = $state({
    name: initial?.name ?? {},
    description: initial?.description ?? {},
    kind: initial?.kind ?? 'ministry',
    category: initial?.category ?? '',
    ageGroup: initial?.ageGroup ?? '',
    leaderId: initial?.leaderId ? String(initial.leaderId) : '',
    contactEmail: initial?.contactEmail ?? '',
    location: initial?.location ?? '',
    meetingDay: initial?.meetingDay ?? '',
    meetingTime: initial?.meetingTime ?? '',
    capacity: initial?.capacity ? String(initial.capacity) : '',
    openToSignup: initial?.openToSignup ?? false,
    defaultSchedule: initial?.defaultSchedule ?? '',
    streaming: initial?.streaming ?? { mode: 'manual', url: '', youtube: '' },
    parentId: initial?.parentId ? String(initial.parentId) : '',
    sortOrder: initial?.sortOrder ?? 0,
    isActive: initial?.isActive ?? true,
  });
  const resolvedLink = $derived(resolveStreamLink(form.streaming));
  let copied = $state(false);
  async function copyLink() { try { await navigator.clipboard.writeText(resolvedLink); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* ignore */ } }
  let error = $state('');
  let saving = $state(false);

  // Leader type-ahead (person search).
  let leaderQuery = $state('');
  let leaderResults = $state<any[]>([]);
  let selectedLeader = $state<any>(initial?.leader ?? null);
  let leaderTimer: ReturnType<typeof setTimeout>;
  function searchLeader() {
    clearTimeout(leaderTimer);
    const q = leaderQuery.trim();
    if (q.length < 2) { leaderResults = []; return; }
    leaderTimer = setTimeout(async () => {
      try { leaderResults = (await api<{ data: any[] }>(`/people?search=${encodeURIComponent(q)}&limit=8`)).data; } catch { leaderResults = []; }
    }, 220);
  }
  function pickLeader(p: any) { selectedLeader = p; form.leaderId = String(p.id); leaderResults = []; leaderQuery = ''; }
  function clearLeader() { selectedLeader = null; form.leaderId = ''; }

  let parentOptions = $state<any[]>([]);
  onMount(async () => {
    if (initial?.leaderId && !selectedLeader) {
      try { const { data } = await api<{ data: any }>(`/people/${initial.leaderId}`); if (data) selectedLeader = data; } catch { /* gone */ }
    }
    const all = (await api<{ data: any[] }>('/ministries')).data;
    if (id == null) { parentOptions = all; return; }
    const blocked = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of all) if (m.parentId != null && blocked.has(m.parentId) && !blocked.has(m.id)) { blocked.add(m.id); grew = true; }
    }
    parentOptions = all.filter((m) => !blocked.has(m.id));
  });

  const AGE_GROUPS = [
    { v: 'children', label: { en: 'Children', ar: 'أطفال' } },
    { v: 'youth', label: { en: 'Youth', ar: 'شباب' } },
    { v: 'adult', label: { en: 'Adults', ar: 'بالغون' } },
  ];
  const CATEGORIES = [
    { en: 'Worship', ar: 'التسبيح' }, { en: 'Children', ar: 'الأطفال' }, { en: 'Youth', ar: 'الشباب' },
    { en: "Women's", ar: 'السيدات' }, { en: "Men's", ar: 'الرجال' }, { en: 'Prayer', ar: 'الصلاة' },
    { en: 'Ushers & Greeters', ar: 'الاستقبال' }, { en: 'Hospitality', ar: 'الضيافة' }, { en: 'Media & AV', ar: 'الإعلام والصوتيات' },
    { en: 'Outreach', ar: 'الكرازة' }, { en: 'Discipleship', ar: 'التلمذة' }, { en: 'Small Group', ar: 'مجموعة صغيرة' },
  ];
  const DAYS = [
    { v: 'Sunday', ar: 'الأحد' }, { v: 'Monday', ar: 'الإثنين' }, { v: 'Tuesday', ar: 'الثلاثاء' },
    { v: 'Wednesday', ar: 'الأربعاء' }, { v: 'Thursday', ar: 'الخميس' }, { v: 'Friday', ar: 'الجمعة' }, { v: 'Saturday', ar: 'السبت' },
  ];
  const isGroup = $derived(form.kind === 'group');

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const hasStream = form.streaming.mode === 'manual' ? form.streaming.url?.trim() : form.streaming.youtube?.trim();
      const body = {
        ...form,
        category: form.category || null,
        ageGroup: form.ageGroup || null,
        leaderId: form.leaderId === '' ? null : Number(form.leaderId),
        contactEmail: form.contactEmail?.trim() || null,
        location: form.location?.trim() || null,
        meetingDay: form.meetingDay || null,
        meetingTime: form.meetingTime || null,
        capacity: form.capacity === '' ? null : Number(form.capacity),
        defaultSchedule: form.defaultSchedule || null,
        streaming: hasStream ? form.streaming : null,
        parentId: form.parentId === '' ? null : Number(form.parentId),
        sortOrder: Number(form.sortOrder),
      };
      if (id) await api(`/ministries/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/ministries', { method: 'POST', body: JSON.stringify(body) });
      if (redirect) await goto('/ministries');
      else onsaved?.();
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="w-full space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card space-y-4 p-6">
    <!-- Kind toggle -->
    <div class="flex gap-2">
      <button type="button" class="flex-1 rounded-md border px-3 py-2 text-sm {!isGroup ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={!isGroup ? 'background: var(--brand)' : ''} onclick={() => (form.kind = 'ministry')}>🙌 {tr({ en: 'Ministry / Team', ar: 'خدمة / فريق' }, $locale)}</button>
      <button type="button" class="flex-1 rounded-md border px-3 py-2 text-sm {isGroup ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={isGroup ? 'background: var(--brand)' : ''} onclick={() => (form.kind = 'group')}>🏡 {tr({ en: 'Small group', ar: 'مجموعة صغيرة' }, $locale)}</button>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      {#each $enabledLocales as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.name[l.code]} required={l.code === 'en'} />
        </label>
      {/each}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Category', ar: 'الفئة' }, $locale)}</span>
        <input class="input" list="ministry-categories" bind:value={form.category} placeholder={tr({ en: 'e.g. Worship', ar: 'مثال: التسبيح' }, $locale)} />
        <datalist id="ministry-categories">{#each CATEGORIES as c}<option value={tr(c, $locale)}></option>{/each}</datalist>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Age group', ar: 'الفئة العمرية' }, $locale)}</span>
        <select class="input" bind:value={form.ageGroup}>
          <option value="">{tr({ en: '— Any —', ar: '— الكل —' }, $locale)}</option>
          {#each AGE_GROUPS as g}<option value={g.v}>{tr(g.label, $locale)}</option>{/each}
        </select>
        {#if form.ageGroup === 'children' || form.ageGroup === 'youth'}
          <span class="text-xs text-amber-600 dark:text-amber-400">⚠️ {tr({ en: 'Members serving here are checked for a valid safeguarding clearance.', ar: 'يُفحص أعضاء هذه الخدمة للتحقق من تصريح الحماية الساري.' }, $locale)}</span>
        {/if}
      </label>
    </div>

    <!-- Leader picker -->
    <div class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Leader / Coordinator', ar: 'القائد / المنسّق' }, $locale)}</span>
      {#if selectedLeader}
        <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
          <span>👤 {displayName(selectedLeader, $nameOrder, $locale)}</span>
          <button type="button" class="ms-auto text-xs text-rose-600 hover:underline" onclick={clearLeader}>{tr({ en: 'Change', ar: 'تغيير' }, $locale)}</button>
        </div>
      {:else}
        <div class="relative">
          <input class="input" bind:value={leaderQuery} oninput={searchLeader} placeholder={tr({ en: 'Search a person…', ar: 'ابحث عن شخص…' }, $locale)} />
          {#if leaderResults.length}
            <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
              {#each leaderResults as p}
                <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickLeader(p)}>{displayName(p, $nameOrder, $locale)}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Description', ar: 'الوصف' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="2" bind:value={form.description[l.code]}></textarea>
      </label>
    {/each}

    <!-- Meeting details -->
    <div class="grid gap-4 sm:grid-cols-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Meeting day', ar: 'يوم الاجتماع' }, $locale)}</span>
        <select class="input" bind:value={form.meetingDay}>
          <option value="">{tr({ en: '—', ar: '—' }, $locale)}</option>
          {#each DAYS as d}<option value={d.v}>{tr({ en: d.v, ar: d.ar }, $locale)}</option>{/each}
        </select>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Time', ar: 'الوقت' }, $locale)}</span>
        <input class="input force-ltr" type="time" bind:value={form.meetingTime} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{isGroup ? tr({ en: 'Host / Location', ar: 'المضيف / المكان' }, $locale) : tr({ en: 'Location / Room', ar: 'المكان / الغرفة' }, $locale)}</span>
        <input class="input" bind:value={form.location} placeholder={isGroup ? tr({ en: "e.g. Smith home", ar: 'مثال: بيت سميث' }, $locale) : tr({ en: 'e.g. Main hall', ar: 'مثال: القاعة الرئيسية' }, $locale)} />
      </label>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Contact email', ar: 'بريد التواصل' }, $locale)}</span>
        <input class="input force-ltr" type="email" bind:value={form.contactEmail} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Team capacity', ar: 'سعة الفريق' }, $locale)}</span>
        <input class="input force-ltr" type="number" min="1" bind:value={form.capacity} placeholder={tr({ en: 'optional', ar: 'اختياري' }, $locale)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Order', ar: 'الترتيب' }, $locale)}</span>
        <input class="input force-ltr" type="number" bind:value={form.sortOrder} />
      </label>
    </div>

    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Parent group (optional)', ar: 'المجموعة الأم (اختياري)' }, $locale)}</span>
      <select class="input" bind:value={form.parentId}>
        <option value="">{tr({ en: '— None (top-level) —', ar: '— بدون (مستوى أعلى) —' }, $locale)}</option>
        {#each parentOptions as p}<option value={String(p.id)}>{tr(p.name, $locale)}</option>{/each}
      </select>
    </label>

    <div class="flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active', ar: 'مُفعّل' }, $locale)}</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.openToSignup} /> {tr({ en: 'Open to public sign-up (share a link)', ar: 'مفتوح للتسجيل العام (شارك رابطاً)' }, $locale)}</label>
    </div>
  </div>

  <!-- Live-stream link -->
  <div class="card space-y-3 p-6">
    <div>
      <h3 class="font-semibold">📺 {tr({ en: 'Live stream', ar: 'البث المباشر' }, $locale)}</h3>
      <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Set a link so you can one-click send "Watch live" to members. YouTube channels resolve to the current live stream automatically.', ar: 'ضع رابطاً لترسل «شاهد البث» للأعضاء بضغطة واحدة. قنوات يوتيوب تُحلّ تلقائياً إلى البث الحالي.' }, $locale)}</p>
    </div>
    <div class="flex gap-2">
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {form.streaming.mode === 'manual' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={form.streaming.mode === 'manual' ? 'background: var(--brand)' : ''} onclick={() => (form.streaming.mode = 'manual')}>{tr({ en: 'Manual link', ar: 'رابط يدوي' }, $locale)}</button>
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {form.streaming.mode === 'youtube' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={form.streaming.mode === 'youtube' ? 'background: var(--brand)' : ''} onclick={() => (form.streaming.mode = 'youtube')}>{tr({ en: 'YouTube (auto)', ar: 'يوتيوب (تلقائي)' }, $locale)}</button>
    </div>
    {#if form.streaming.mode === 'manual'}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Stream URL', ar: 'رابط البث' }, $locale)}</span>
        <input class="input force-ltr" placeholder="https://…" bind:value={form.streaming.url} />
      </label>
    {:else}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'YouTube channel handle or ID', ar: 'معرّف قناة يوتيوب' }, $locale)}</span>
        <input class="input force-ltr" placeholder="@YourChurch  ·  or UCxxxx…" bind:value={form.streaming.youtube} />
      </label>
    {/if}
    {#if resolvedLink}
      <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
        <a href={resolvedLink} target="_blank" rel="noopener" class="force-ltr truncate text-sky-600 hover:underline dark:text-sky-400">{resolvedLink}</a>
        <button type="button" class="ms-auto shrink-0 text-slate-500 hover:underline" onclick={copyLink}>{copied ? tr({ en: 'Copied ✓', ar: 'تم النسخ ✓' }, $locale) : tr({ en: 'Copy', ar: 'نسخ' }, $locale)}</button>
      </div>
    {/if}
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    {#if redirect}<a class="btn-ghost" href="/ministries">✕</a>{:else}<button type="button" class="btn-ghost" onclick={() => onsaved?.()}>{$t('common.cancel')}</button>{/if}
  </div>
</form>
