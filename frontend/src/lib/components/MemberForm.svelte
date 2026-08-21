<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales, displayName, personContext } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import AddressAutocomplete from '$lib/components/AddressAutocomplete.svelte';

  function fillAddr(a: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string }) {
    if (a.line1) form.addressLine1 = a.line1;
    if (a.line2) form.addressLine2 = a.line2;
    if (a.city) form.city = a.city;
    if (a.region) form.region = a.region;
    if (a.postalCode) form.postalCode = a.postalCode;
    if (a.country) form.country = a.country;
  }

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  // Type-ahead family picker (scales past the old flat 100-family list).
  let familyResults = $state<any[]>([]);
  let familyQuery = $state('');
  let selectedFamily = $state<any>(null);
  let form = $state({
    givenName: initial?.givenName ?? {},
    middleName: initial?.middleName ?? {},
    nickName: initial?.nickName ?? {},
    familyName: initial?.familyName ?? {},
    householdId: initial?.householdId ? String(initial.householdId) : '',
    householdRole: initial?.householdRole ?? '',
    addressLine1: initial?.addressLine1 ?? '',
    addressLine2: initial?.addressLine2 ?? '',
    city: initial?.city ?? '',
    region: initial?.region ?? '',
    postalCode: initial?.postalCode ?? '',
    country: initial?.country ?? '',
    membershipStatus: initial?.membershipStatus ?? 'visitor',
    email: initial?.email ?? '',
    mobile: initial?.mobile ?? '',
    preferredLanguage: initial?.preferredLanguage ?? 'en',
    dateOfBirth: initial?.dateOfBirth ?? '',
    joinedOn: initial?.joinedOn ?? '',
    isActive: initial?.isActive ?? true,
    emailOptOut: initial?.emailOptOut ?? false,
    smsOptOut: initial?.smsOptOut ?? false,
    whatsappOptOut: initial?.whatsappOptOut ?? false,
    skills: (initial?.skills ?? []) as string[],
  });
  let saving = $state(false);
  let error = $state('');

  // Duplicate guard: as the name is typed, surface existing active people with the
  // same first+last so staff don't create a second record for the same person.
  let dupes = $state<any[]>([]);
  let dupeTimer: ReturnType<typeof setTimeout>;
  function checkDupes() {
    clearTimeout(dupeTimer);
    const given = (form.givenName?.en ?? '').trim();
    const family = (form.familyName?.en ?? '').trim();
    if (given.length < 2) { dupes = []; return; }
    dupeTimer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ given });
        if (family) q.set('family', family);
        if (id) q.set('exclude', String(id));
        dupes = (await api<{ data: any[] }>(`/people/duplicates?${q}`)).data;
      } catch { dupes = []; }
    }, 350);
  }

  // Skills / gifts / interests — free tags for ministry matching.
  let newSkill = $state('');
  function addSkill() {
    const s = newSkill.trim();
    if (s && !form.skills.includes(s)) form.skills = [...form.skills, s];
    newSkill = '';
  }
  function removeSkill(s: string) { form.skills = form.skills.filter((x) => x !== s); }
  function skillKey(e: KeyboardEvent) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(); } }

  // Inline "quick create" for a family, so the admin never has to leave this form.
  let showNewFamily = $state(false);
  let newFamilyName = $state('');
  let creatingFamily = $state(false);

  const statuses = ['visitor', 'regular', 'member', 'inactive'];
  const ROLE_OPTIONS = [
    { v: 'head', en: 'Head', ar: 'رب الأسرة' }, { v: 'husband', en: 'Husband', ar: 'زوج' }, { v: 'wife', en: 'Wife', ar: 'زوجة' },
    { v: 'father', en: 'Father', ar: 'أب' }, { v: 'mother', en: 'Mother', ar: 'أم' }, { v: 'son', en: 'Son', ar: 'ابن' },
    { v: 'daughter', en: 'Daughter', ar: 'ابنة' }, { v: 'brother', en: 'Brother', ar: 'أخ' }, { v: 'sister', en: 'Sister', ar: 'أخت' },
    { v: 'grandparent', en: 'Grandparent', ar: 'جد/جدة' }, { v: 'guardian', en: 'Guardian', ar: 'وصي' }, { v: 'other', en: 'Other', ar: 'أخرى' },
  ];
  function roleValue(r?: string | null) {
    const x = (r ?? '').trim().toLowerCase();
    if (!x) return '';
    if (x === 'self' || x === 'رب الأسرة') return 'head';
    return ROLE_OPTIONS.some((o) => o.v === x) ? x : (r ?? '').trim();
  }

  onMount(async () => {
    // Show the member's current family (if editing) without loading everything.
    const hid = initial?.householdId;
    if (hid) {
      try { const { data } = await api<{ data: any }>(`/families/${hid}`); if (data) selectedFamily = data; } catch { /* household may be gone */ }
    }
  });

  let searchTimer: ReturnType<typeof setTimeout>;
  function searchFamilies() {
    clearTimeout(searchTimer);
    const q = familyQuery.trim();
    if (!q) { familyResults = []; return; }
    searchTimer = setTimeout(async () => {
      try { familyResults = (await api<{ data: any[] }>(`/families?search=${encodeURIComponent(q)}&limit=15`)).data; } catch { familyResults = []; }
    }, 200);
  }
  function pickFamily(f: any) { selectedFamily = f; form.householdId = String(f.id); familyResults = []; familyQuery = ''; }
  function clearFamily() { selectedFamily = null; form.householdId = ''; familyQuery = ''; familyResults = []; }

  async function createFamily() {
    if (!newFamilyName.trim()) return;
    creatingFamily = true;
    try {
      const { data } = await api<{ data: any }>('/families', {
        method: 'POST',
        body: JSON.stringify({ name: { en: newFamilyName.trim() } }),
      });
      pickFamily(data);
      showNewFamily = false;
      newFamilyName = '';
    } catch (err) {
      error = (err as Error).message;
    } finally { creatingFamily = false; }
  }

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = {
        ...form,
        householdId: form.householdId === '' ? null : Number(form.householdId),
        householdRole: form.householdRole?.trim() || null,
        email: form.email || null,
        mobile: form.mobile || null,
        dateOfBirth: form.dateOfBirth || null,
        joinedOn: form.joinedOn || null,
        addressLine1: form.addressLine1?.trim() || null,
        addressLine2: form.addressLine2?.trim() || null,
        city: form.city?.trim() || null,
        region: form.region?.trim() || null,
        postalCode: form.postalCode?.trim() || null,
        country: form.country?.trim() || null,
      };
      if (id) await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/people', { method: 'POST', body: JSON.stringify(body) });
      await goto('/members');
    } catch (err) {
      error = (err as Error).message;
    } finally { saving = false; }
  }
</script>

<form class="w-full space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card space-y-4 p-6">
    {#each $enabledLocales as l}
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.givenName[l.code]} oninput={checkDupes} required={l.code === 'en'} />
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: "Middle / father's", ar: 'الأوسط / اسم الأب' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.middleName[l.code]} />
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.familyName[l.code]} oninput={checkDupes} />
        </label>
      </div>
    {/each}
    <div class="grid gap-4 sm:grid-cols-3">
      {#each $enabledLocales as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Nickname', ar: 'اللقب' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.nickName[l.code]} placeholder={tr({ en: 'e.g. Sam', ar: 'مثال: سام' }, $locale)} />
        </label>
      {/each}
    </div>
    <p class="text-xs text-slate-400">{tr({ en: "Middle / father's name and nickname are optional — they help tell apart people who share a last name, and show under the full name.", ar: 'الاسم الأوسط / اسم الأب واللقب اختياريان — يساعدان على التمييز بين من يتشاركون اسم العائلة، ويظهران تحت الاسم الكامل.' }, $locale)}</p>
  </div>

  {#if dupes.length}
    <div class="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
      <p class="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">⚠️ {tr({ en: 'Someone with this name already exists', ar: 'يوجد شخص بهذا الاسم بالفعل' }, $locale)} ({dupes.length})</p>
      <p class="mb-2 text-xs text-amber-700 dark:text-amber-300">{tr({ en: 'Is it one of these? Open the existing record instead of creating a duplicate.', ar: 'هل هو أحد هؤلاء؟ افتح السجل الموجود بدلاً من إنشاء نسخة مكررة.' }, $locale)}</p>
      <ul class="space-y-1">
        {#each dupes as d}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{d.id}" target="_blank" rel="noopener">{displayName(d, $nameOrder, $locale)}</a>
            <span class="text-xs text-slate-500">{personContext(d, $locale)}</span>
            {#if d.mobile || d.email}<span class="force-ltr text-xs text-slate-400">· {d.mobile || d.email}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
      <select class="input capitalize" bind:value={form.membershipStatus}>{#each statuses as s}<option value={s}>{s}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Preferred language', ar: 'اللغة المفضلة' }, $locale)}</span>
      <select class="input" bind:value={form.preferredLanguage}>{#each $enabledLocales as l}<option value={l.code}>{l.native}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span>
      <input class="input force-ltr" type="email" bind:value={form.email} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</span>
      <input class="input force-ltr" bind:value={form.mobile} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">🎂 {tr({ en: 'Date of birth', ar: 'تاريخ الميلاد' }, $locale)}</span>
      <input class="input force-ltr" type="date" bind:value={form.dateOfBirth} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">🎉 {tr({ en: 'Joined the church', ar: 'تاريخ الانضمام' }, $locale)}</span>
      <input class="input force-ltr" type="date" bind:value={form.joinedOn} />
    </label>
    <div class="block space-y-1 sm:col-span-2">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Family', ar: 'العائلة' }, $locale)}</span>
      {#if showNewFamily}
        <div class="flex gap-2">
          <input class="input" bind:value={newFamilyName} placeholder={tr({ en: 'New family name', ar: 'اسم عائلة جديد' }, $locale)} />
          <button type="button" class="btn-primary shrink-0" onclick={createFamily} disabled={creatingFamily}>{creatingFamily ? '…' : tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
          <button type="button" class="btn-ghost shrink-0" onclick={() => { showNewFamily = false; }}>✕</button>
        </div>
      {:else if selectedFamily}
        <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
          <span>👪 {tr(selectedFamily.name ?? {}, $locale)}</span>
          <button type="button" class="ms-auto text-xs text-rose-600 hover:underline" onclick={clearFamily}>{tr({ en: 'Change', ar: 'تغيير' }, $locale)}</button>
        </div>
      {:else}
        <div class="relative">
          <div class="flex gap-2">
            <input class="input" bind:value={familyQuery} oninput={searchFamilies} placeholder={tr({ en: 'Search a family…', ar: 'ابحث عن عائلة…' }, $locale)} />
            {#if can('create household')}<button type="button" class="btn-ghost shrink-0 whitespace-nowrap" onclick={() => { showNewFamily = true; }}>+ {tr({ en: 'New', ar: 'جديد' }, $locale)}</button>{/if}
          </div>
          {#if familyResults.length}
            <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
              {#each familyResults as f}
                <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickFamily(f)}>{tr(f.name ?? {}, $locale)}{#if f.city}<span class="text-slate-400"> · {f.city}</span>{/if}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {#if form.householdId}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Role in family', ar: 'الدور في العائلة' }, $locale)}</span>
        <select class="input" value={roleValue(form.householdRole)} onchange={(e) => (form.householdRole = (e.currentTarget as HTMLSelectElement).value)}>
          <option value="">{tr({ en: '— none —', ar: '— بدون —' }, $locale)}</option>
          {#each ROLE_OPTIONS as o}<option value={o.v}>{tr({ en: o.en, ar: o.ar }, $locale)}</option>{/each}
          {#if roleValue(form.householdRole) && !ROLE_OPTIONS.some((o) => o.v === roleValue(form.householdRole))}<option value={roleValue(form.householdRole)}>{form.householdRole}</option>{/if}
        </select>
      </label>
    {/if}
  </div>

  <!-- Optional per-person address (blank → the family's address is used) -->
  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    <div class="sm:col-span-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🏠 {tr({ en: 'Home address (optional)', ar: 'عنوان المنزل (اختياري)' }, $locale)}</h2>
      <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: "Leave blank to use the family's address. Fill this only if this person lives somewhere different.", ar: 'اتركه فارغاً لاستخدام عنوان العائلة. املأه فقط إذا كان هذا الشخص يقيم في مكان مختلف.' }, $locale)}</p>
    </div>
    <div class="sm:col-span-2"><AddressAutocomplete onpick={fillAddr} /></div>
    <label class="block space-y-1 sm:col-span-2"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address line 1', ar: 'العنوان ١' }, $locale)}</span><input class="input" bind:value={form.addressLine1} /></label>
    <label class="block space-y-1 sm:col-span-2"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address line 2', ar: 'العنوان ٢' }, $locale)}</span><input class="input" bind:value={form.addressLine2} /></label>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'City', ar: 'المدينة' }, $locale)}</span><input class="input" bind:value={form.city} /></label>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Region', ar: 'المنطقة' }, $locale)}</span><input class="input" bind:value={form.region} /></label>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Postal code', ar: 'الرمز البريدي' }, $locale)}</span><input class="input force-ltr" bind:value={form.postalCode} /></label>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Country', ar: 'الدولة' }, $locale)}</span><input class="input" bind:value={form.country} /></label>
  </div>

  <div class="card space-y-3 p-6">
    <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">✨ {tr({ en: 'Skills, gifts & interests', ar: 'المواهب والاهتمامات' }, $locale)}</h2>
    <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Tags to help match & recruit this person into ministries (e.g. plays guitar, good with kids, speaks Arabic).', ar: 'وسوم للمساعدة في ترشيح هذا الشخص للخدمات (مثال: يعزف الجيتار، بارع مع الأطفال).' }, $locale)}</p>
    {#if form.skills.length}
      <div class="flex flex-wrap gap-2">
        {#each form.skills as s}
          <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">{s}<button type="button" class="text-slate-400 hover:text-rose-600" onclick={() => removeSkill(s)}>✕</button></span>
        {/each}
      </div>
    {/if}
    <div class="flex gap-2">
      <input class="input" bind:value={newSkill} onkeydown={skillKey} placeholder={tr({ en: 'Add a skill and press Enter', ar: 'أضف مهارة واضغط Enter' }, $locale)} maxlength="40" />
      <button type="button" class="btn-ghost shrink-0" onclick={addSkill}>{tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
    </div>
  </div>

  <div class="card space-y-3 p-6">
    <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'Messaging consent', ar: 'موافقة المراسلة' }, $locale)}</h2>
    <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'When ticked, this person will NOT receive that channel (they opted out).', ar: 'عند التحديد، لن يتلقى هذا الشخص تلك القناة (انسحب).' }, $locale)}</p>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.emailOptOut} /> {tr({ en: 'Opted out of email', ar: 'منسحب من البريد' }, $locale)}</label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.smsOptOut} /> {tr({ en: 'Opted out of SMS', ar: 'منسحب من الرسائل النصية' }, $locale)}</label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.whatsappOptOut} /> {tr({ en: 'Opted out of WhatsApp', ar: 'منسحب من واتساب' }, $locale)}</label>
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/members">✕</a>
  </div>
</form>
