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
  // Family assignment saves instantly when editing an existing member (no need to
  // hit the form's Save). `changingFamily` shows the search while keeping the
  // current family until a new one is picked; `familySaved` flashes a ✓.
  let changingFamily = $state(false);
  let familySaved = $state(false);
  function flashSaved() { familySaved = true; setTimeout(() => (familySaved = false), 1600); }

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
  // Persist a household/role change immediately for an existing member; for a NEW
  // member it just stays in form state and is saved when the member is created.
  async function persistPatch(patch: Record<string, unknown>) {
    if (!id) return;
    try { await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); flashSaved(); }
    catch (err) { error = (err as Error).message; }
  }
  async function pickFamily(f: any) { selectedFamily = f; form.householdId = String(f.id); familyResults = []; familyQuery = ''; changingFamily = false; await persistPatch({ householdId: f.id }); }
  async function removeFamily() { selectedFamily = null; form.householdId = ''; form.householdRole = ''; familyQuery = ''; familyResults = []; changingFamily = false; await persistPatch({ householdId: null, householdRole: null }); }
  function startChangeFamily() { changingFamily = true; familyQuery = ''; familyResults = []; }
  async function setFamilyRole(v: string) { form.householdRole = v; await persistPatch({ householdRole: v || null }); }

  async function createFamily() {
    if (!newFamilyName.trim()) return;
    creatingFamily = true;
    try {
      const { data } = await api<{ data: any }>('/families', {
        method: 'POST',
        body: JSON.stringify({ name: { en: newFamilyName.trim() } }),
      });
      await pickFamily(data);
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
  </div>

  <!-- Family / Household — its own dedicated card so it's easy to find and change. -->
  <div class="card p-6">
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">👪 {tr({ en: 'Family / Household', ar: 'العائلة / الأسرة' }, $locale)}</span>
        {#if familySaved}<span class="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'Saved', ar: 'تم الحفظ' }, $locale)}</span>{/if}
      </div>
      <p class="text-xs text-slate-400">{id ? tr({ en: 'Changes here save instantly.', ar: 'التغييرات هنا تُحفظ فوراً.' }, $locale) : tr({ en: 'Group this person into a household — they share an address and appear together on the family page.', ar: 'اجمع هذا الشخص في أسرة — يتشاركون العنوان ويظهرون معاً في صفحة العائلة.' }, $locale)}</p>

      {#if showNewFamily}
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p class="mb-2 text-xs font-medium text-slate-500">{tr({ en: 'Create a new family', ar: 'إنشاء عائلة جديدة' }, $locale)}</p>
          <div class="flex flex-wrap gap-2">
            <input class="input min-w-[10rem] flex-1" bind:value={newFamilyName} placeholder={tr({ en: 'Family name (e.g. Ibrahim)', ar: 'اسم العائلة (مثال: إبراهيم)' }, $locale)} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createFamily(); } }} />
            <button type="button" class="btn-primary shrink-0" onclick={createFamily} disabled={creatingFamily || !newFamilyName.trim()}>{creatingFamily ? '…' : tr({ en: 'Create & assign', ar: 'إنشاء وتعيين' }, $locale)}</button>
            <button type="button" class="btn-ghost shrink-0" onclick={() => { showNewFamily = false; }}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
          </div>
        </div>
      {:else if selectedFamily && !changingFamily}
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div class="flex items-start gap-3">
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl" style="background: color-mix(in srgb, var(--brand) 15%, transparent)">👪</span>
            <div class="min-w-0 flex-1">
              <div class="font-medium">{tr(selectedFamily.name ?? {}, $locale)}</div>
              {#if selectedFamily.membersPreview}<div class="truncate text-xs text-slate-500 dark:text-slate-400">{selectedFamily.membersPreview}</div>{/if}
              <div class="text-xs text-slate-400">{#if selectedFamily.city}{selectedFamily.city}{/if}{#if selectedFamily.memberCount != null}{selectedFamily.city ? ' · ' : ''}{selectedFamily.memberCount} {tr({ en: 'members', ar: 'أفراد' }, $locale)}{/if}</div>
            </div>
            {#if form.householdId}<a class="shrink-0 text-xs text-primary-700 hover:underline dark:text-primary-300" href="/families/{form.householdId}" target="_blank" rel="noopener">{tr({ en: 'Open →', ar: 'فتح ←' }, $locale)}</a>{/if}
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <label class="flex items-center gap-2 text-sm">
              <span class="text-slate-500">{tr({ en: 'Role', ar: 'الدور' }, $locale)}</span>
              <select class="input h-8 w-36 py-0 text-sm" value={roleValue(form.householdRole)} onchange={(e) => setFamilyRole((e.currentTarget as HTMLSelectElement).value)}>
                <option value="">{tr({ en: '— none —', ar: '— بدون —' }, $locale)}</option>
                {#each ROLE_OPTIONS as o}<option value={o.v}>{tr({ en: o.en, ar: o.ar }, $locale)}</option>{/each}
                {#if roleValue(form.householdRole) && !ROLE_OPTIONS.some((o) => o.v === roleValue(form.householdRole))}<option value={roleValue(form.householdRole)}>{form.householdRole}</option>{/if}
              </select>
            </label>
            <button type="button" class="ms-auto text-xs text-slate-500 hover:underline" onclick={startChangeFamily}>{tr({ en: 'Change family', ar: 'تغيير العائلة' }, $locale)}</button>
            <button type="button" class="text-xs text-rose-600 hover:underline" onclick={removeFamily}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button>
          </div>
        </div>
      {:else}
        {#if changingFamily && selectedFamily}
          <p class="text-xs text-slate-400">{tr({ en: 'Pick a different family below, or', ar: 'اختر عائلة أخرى بالأسفل، أو' }, $locale)} <button type="button" class="text-slate-500 hover:underline" onclick={() => { changingFamily = false; familyQuery = ''; familyResults = []; }}>{tr({ en: 'keep', ar: 'أبقِ على' }, $locale)} “{tr(selectedFamily.name ?? {}, $locale)}”</button>.</p>
        {/if}
        <div class="relative">
          <input class="input" bind:value={familyQuery} oninput={searchFamilies} placeholder={tr({ en: 'Type a family name to search…', ar: 'اكتب اسم عائلة للبحث…' }, $locale)} />
          {#if familyResults.length}
            <div class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {#each familyResults as f}
                <button type="button" class="flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickFamily(f)}>
                  <span class="mt-0.5">👪</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium">{tr(f.name ?? {}, $locale)}<span class="ms-1 text-xs font-normal text-slate-400">{#if f.city}· {f.city}{/if}{#if f.memberCount != null} · {f.memberCount}{/if}</span></span>
                    {#if f.membersPreview}<span class="block truncate text-xs text-slate-400">{f.membersPreview}</span>{/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{tr({ en: "Can't find them?", ar: 'لا تجدها؟' }, $locale)}</span>
          {#if can('create household')}<button type="button" class="font-medium hover:underline" style="color: var(--brand)" onclick={() => { newFamilyName = familyQuery.trim(); showNewFamily = true; }}>＋ {tr({ en: 'Create a new family', ar: 'إنشاء عائلة جديدة' }, $locale)}</button><span>·</span>{/if}
          <span>{tr({ en: 'or leave unassigned', ar: 'أو بدون عائلة' }, $locale)}</span>
        </div>
      {/if}
    </div>
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
